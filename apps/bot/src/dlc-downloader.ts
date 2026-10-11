import {UserBot} from "@/userbot.js";
import {Api} from "telegram";
import {PersistentQueue} from "@/persistent-queue.js";
import {DownloadTask, MediaDownloadTask, Mirror} from "@/types/download-task.js";
import fs from "fs";
import {Logger} from "@/logger.js";
import {Loading, ThumbsDown, ThumbsUp} from "@/constants/emoticon.js";
import {Environment} from "@/types/env.type.js";
import path from "node:path";
import {JDownloader} from "@/jdownloader.js";
import QueryLinkResponse = JDownloader.QueryLink.QueryLinkResponse;
import {resolvePath} from "@/utils.js";
import {HostRegistry} from "@/host/host-registry.js";
import {IHost} from "@/host/host.js";

// Mirrors without a resolved file name are matched to a file by size. Hosts often report rounded sizes
// (filekeeper and send.now report the same rounded value), so exact matches win, then this tolerance applies.
const SIZE_MATCH_TOLERANCE = 0.0001;

interface FailedAttempt {
    mirror: Mirror;
    host: IHost;
    error: string;
}

export class DLCDownloader {
    private readonly userBot: UserBot;
    private readonly _queue: PersistentQueue<ReturnType<DownloadTask['serializable']>>;
    private readonly _mediaDownloadQueue : PersistentQueue<ReturnType<MediaDownloadTask['serializable']>>;
    private _hostRegistry: HostRegistry | undefined;

    constructor(userBot: UserBot) {
        this.userBot = userBot;
        this._queue  = new PersistentQueue(
            (data) => this.processTask(DownloadTask.deserialize(data)),
            {
                concurrency: 1, //JDownloader gets complicated
                dbPath: './downloads-queue-dlc.json'
            }
        );
        this._mediaDownloadQueue = new PersistentQueue(
            (data) => this.processDownload(data),
            {
                concurrency: 1,
                dbPath: './downloads-queue-media.json'
            }
        )
    }

    public async download(telegramMessage: Api.Message){
        this._queue.push(String(telegramMessage.id), DownloadTask.fromMessage(telegramMessage!, telegramMessage.text).serializable());
    }

    private get hostRegistry(): HostRegistry {
        // Created lazily, the persisted queue can start processing before the userbot finished constructing
        this._hostRegistry ??= new HostRegistry(this.userBot.jDownloader);
        return this._hostRegistry;
    }

    private async processDownload(task: ReturnType<MediaDownloadTask['serializable']>) {
        const download = MediaDownloadTask.deserialize(task);
        Logger.info(`Processing media download: ${download}`);

        const planned = this.hostRegistry.plan(
            download.mirrors.filter(mirror => mirror.availability !== 'OFFLINE')
        );

        if (planned.length === 0) {
            Logger.warn(`No downloadable mirrors for ${download.name}, skipping.`);
            await this.sendToChannel(`Failed to download [${download.name}]: no supported online mirrors\n${this.formatMirrors(download.mirrors)}`);
            return;
        }

        let tempPath: string | undefined;

        try {
            Logger.info(`Extracting media info for file: ${download.name}`);
            const response = await this.userBot.llmModelManager.extractMediaInfo(download.name);
            Logger.info(`Extracted media info: ${JSON.stringify(response)}`);

            const ext = path.extname(download.name).slice(1) || 'mkv';
            const resolved = await this.userBot.tmdbClient.resolve(response.candidateTitle, {
                isMovie: response.isMovie,
                year: response.year,
                season: response.season,
                episode: response.episode,
                fileExtension: ext
            });

            if (!resolved) {
                Logger.warn(`Failed to resolve media for: ${download.name}, skipping.`);
                return;
            }

            Logger.info(`Resolved media: ${JSON.stringify(resolved)}`);

            const fileTemplate = resolved.type === 'movie'
                ? Environment.get().options.MOVIE_PATH
                : Environment.get().options.SERIES_PATH;

            const downloadPath = path.join(
                Environment.get().options.MEDIA_ROOT,
                resolvePath(fileTemplate, resolved)
            );

            fs.mkdirSync(path.dirname(downloadPath), { recursive: true });
            tempPath = `${downloadPath}.tmp`;

            const failures: FailedAttempt[] = [];

            for (const { mirror, host } of planned) {
                Logger.info(`Downloading ${download.name} from ${this.describe(mirror, host)}: ${mirror.url}`);

                let error: string | undefined;
                try {
                    const result = await host.download(mirror.url, tempPath);
                    if (!result.status) error = result.error ?? 'Unknown error';
                } catch (err) {
                    error = String(err);
                }

                if (error) {
                    Logger.warn(`Download failed for ${mirror.url}: ${error}`);
                    failures.push({ mirror, host, error });
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    continue;
                }

                fs.renameSync(tempPath, downloadPath);
                Logger.info(`Saved: ${downloadPath}`);

                await this.sendToChannel(
                    `Downloaded ${resolved.title}[${download.name}] from ${this.describe(mirror, host)} (${mirror.url}) to ${downloadPath}`
                    + this.formatFailures(failures)
                );

                await this.userBot.jellyfinManager.tryRefresh();
                return;
            }

            Logger.warn(`All mirrors failed for ${download.name}`);
            await this.sendToChannel(`Failed to download ${resolved.title}[${download.name}] from every mirror` + this.formatFailures(failures));
        } catch (err) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            Logger.error(`Failed to process download ${download}: ${err}`);
            throw err;
        }
    }

    private describe(mirror: Mirror, host: IHost) {
        return host.name === mirror.host ? mirror.host : `${mirror.host} via ${host.name}`;
    }

    private formatFailures(failures: FailedAttempt[]) {
        if (failures.length === 0) return '';
        return '\nFailed mirrors:\n' + failures
            .map(({ mirror, host, error }) => `- ${this.describe(mirror, host)} (${mirror.url}): ${error}`)
            .join('\n');
    }

    private formatMirrors(mirrors: Mirror[]) {
        return mirrors.map(mirror => `- ${mirror.host} (${mirror.url}): ${mirror.availability}`).join('\n');
    }

    private async sendToChannel(message: string) {
        const channel = Environment.get().options.FORWARD_CHANNELS;
        if (channel.length === 0) return;

        try {
            const client = this.userBot.telegramClient;
            const channelEntity = await client.getEntity(channel[0]);
            await client.sendMessage(channelEntity, { message, linkPreview: false });
        } catch (e) {
            Logger.error(`Failed to send message to channel: ${e}`);
        }
    }

    private async processTask(task: DownloadTask){
        console.log("Processing DLC download task:", task);
        const client = this.userBot.telegramClient;
        const messages = await client.getMessages(task.chatId, {ids: [task.messageId]});
        const message = messages[0];

        if (!message) {
            Logger.warn(`Message ${task.messageId} not found, skipping.`);
            return;
        }

        if(!message.file){
            Logger.warn(`Message ${task.messageId} has no file, skipping.`);
            return;
        }

        const dlcPath = await this.downloadAndWriteToTempPath(message);
        if(!dlcPath){
            Logger.warn(`Failed to download DLC for message ${task.messageId}, skipping.`);
            return;
        }

        this.userBot.interactionHandler.react(message.chatId, message.id, ThumbsUp)
            .catch((err) => Logger.error(`Failed to react to message: ${err}`));

        Logger.info(`DLC download task completed for message ${task.messageId} and saved to ${dlcPath}`);

        const addLinkResponse = await this.userBot.jDownloader.addDlcForLinkGrab({
            path: dlcPath
        });

        if(!addLinkResponse){
            Logger.warn(`Failed to add DLC to JDownloader for message ${task.messageId}, skipping.`);
            this.userBot.interactionHandler.react(message.chatId, message.id, ThumbsDown)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));
            return;
        }


        const response = await this.pollAndGetUrls(addLinkResponse.id);
        const downloads = this.groupMirrors(response);

        if(downloads.length === 0){
            Logger.warn(`No online links found for message ${task.messageId}, skipping.`);
            this.userBot.interactionHandler.react(message.chatId, message.id, ThumbsDown)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));
            return;
        }

        const hosts = [...new Set(downloads.flatMap(download => download.mirrors.map(mirror => mirror.host)))];
        const summary = `Found ${downloads.length} files on ${hosts.join(', ')}, queuing downloads...`;
        Logger.info(summary);
        this.userBot.interactionHandler.replyToMessage(message.chatId, message.id, summary, true)
            .catch((err) => Logger.error(`Failed to reply to message: ${err}`))
        this.userBot.interactionHandler.react(message.chatId, message.id, Loading)
            .catch((err) => Logger.error(`Failed to react to message: ${err}`));
        for (const download of downloads) {
            this._mediaDownloadQueue.push(download.name, download.serializable());
        }

        fs.unlinkSync(dlcPath);
        Logger.info(`Cleaned up DLC file: ${dlcPath}`);
    }

    /**
     * DLCs list every file once per host. Groups those mirrors by JDownloader's resolved file name,
     * links whose name couldn't be resolved (e.g. send.now) are attached by size when it matches a single file.
     */
    private groupMirrors(links: QueryLinkResponse[]): MediaDownloadTask[] {
        const online = links.filter(link => link.availability !== 'OFFLINE');
        const groups = new Map<string, MediaDownloadTask>();
        const unnamed: QueryLinkResponse[] = [];

        for (const link of online) {
            if (!/\.[a-z0-9]{2,4}$/i.test(link.name)) {
                unnamed.push(link);
                continue;
            }

            const group = groups.get(link.name);
            if (group) group.mirrors.push(MediaDownloadTask.mirrorOf(link));
            else groups.set(link.name, MediaDownloadTask.fromLink(link));
        }

        const matchBySize = (size: number, tolerance: number) => [...groups.values()].filter(group =>
            group.mirrors.some(mirror =>
                mirror.bytesTotal && Math.abs(mirror.bytesTotal - size) / mirror.bytesTotal <= tolerance));

        for (const link of unnamed) {
            const size = link.bytesTotal;
            let matches = size && size > 0 ? matchBySize(size, 0) : [];
            if (size && size > 0 && matches.length === 0) matches = matchBySize(size, SIZE_MATCH_TOLERANCE);

            if (matches.length === 1) {
                matches[0].mirrors.push(MediaDownloadTask.mirrorOf(link));
            } else {
                Logger.warn(`Dropping ${link.host} link ${link.url}: could not match it to a single file (${matches.length} candidates)`);
            }
        }

        return [...groups.values()];
    }

    private async pollAndGetUrls(jobId: number): Promise<JDownloader.QueryLink.QueryLinkResponse[]> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                clearInterval(interval);
                reject(new Error(`Timed out waiting for JDownloader job ${jobId} after 3 minutes`));
            }, 1000 * 60 * 3);

            const interval = setInterval(async () => {
                try {
                    // const isCollecting = await this.userBot.jDownloader.isCollecting();
                    // if (!isCollecting) {
                    //     Logger.info(`JDownloader is still collecting for job ${jobId}`);
                    //     return;
                    // }

                    const jDownloaderResponse = await this.userBot.jDownloader.queryLink(jobId);
                    if (jDownloaderResponse.data.length === 0) {
                        Logger.warn(`JDownloader returned no URLs for job ${jobId}, retrying until timeout.`);
                        return;
                    }

                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve(jDownloaderResponse.data);
                } catch (e) {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    reject(e);
                }
            }, 1000 * 60);
        });
    }

    private async downloadAndWriteToTempPath(message: Api.Message){
        const downloadDir = Environment.get().options.JDOWNLOADER_DLC_PATH!;
        const downloadPath = path.join(downloadDir, message.file!.name);

        fs.mkdirSync(downloadDir, { recursive: true });

        const buffer = await this.userBot.telegramClient.downloadMedia(message, {});
        if (!buffer) {
            Logger.warn("No DLC File downloaded, skipping")
            return;
        }

        if(fs.existsSync(downloadPath)){
            fs.unlinkSync(downloadPath);
        }

        fs.writeFileSync(downloadPath, buffer as Buffer);
        Logger.info(`DLC saved to: ${downloadPath}`)

        return downloadPath;
    }
}