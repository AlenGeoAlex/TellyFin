import {UserBot} from "@/userbot.js";
import {Api} from "telegram";
import {PersistentQueue} from "@/persistent-queue.js";
import {DLCDownloadTask, DownloadTask, QueryLinkTask} from "@/types/download-task.js";
import fs from "fs";
import {Logger} from "@/logger.js";
import {ThumbsDown, ThumbsUp} from "@/constants/emoticon.js";
import {Environment} from "@/types/env.type.js";
import path from "node:path";
import {JDownloader} from "@/jdownloader.js";
import QueryLinkResponse = JDownloader.QueryLink.QueryLinkResponse;
import {resolvePath} from "@/utils.js";
import {PixelDrainHost} from "@/host/pixel-drain.host.js";

export class DLCDownloader {
    private readonly userBot: UserBot;
    private readonly _queue: PersistentQueue<ReturnType<DownloadTask['serializable']>>;
    private readonly _mediaDownloadQueue : PersistentQueue<QueryLinkResponse>;

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

    private async processDownload(task: ReturnType<QueryLinkTask['serializable']>) {
        const download = QueryLinkTask.deserialize(task);
        Logger.info(`Processing media download: ${download}`);

        if (download.availability !== 'ONLINE') {
            Logger.warn(`Link ${download.url} is not online (${download.availability}), skipping.`);
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

            const downloadResponse = await new PixelDrainHost().download(download.url, tempPath);
            if(!downloadResponse.status) {
                Logger.warn(`Download failed for ${download.url}: ${downloadResponse.error}`);
                return;
            }

            fs.renameSync(tempPath, downloadPath);
            Logger.info(`Saved: ${downloadPath}`);

            await this.userBot.jellyfinManager.tryRefresh();
        } catch (err) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            Logger.error(`Failed to process download ${download}: ${err}`);
            throw err;
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
        const pixelDrainLinks = response.filter(link => link.host === 'pixeldrain.com');

        if(!pixelDrainLinks || pixelDrainLinks.length === 0){
            Logger.warn(`No PixelDrain links found for message ${task.messageId}, skipping.`);
            this.userBot.interactionHandler.react(message.chatId, message.id, ThumbsDown)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));
            return;
        }

        Logger.info(`Found ${pixelDrainLinks.length} PixelDrain links, queuing downloads...`);
        for (const link of pixelDrainLinks) {
            this._mediaDownloadQueue.push(link.url, link);
        }

        fs.unlinkSync(dlcPath);
        Logger.info(`Cleaned up DLC file: ${dlcPath}`);
    }

    private async pollAndGetUrls(jobId: number): Promise<JDownloader.QueryLink.QueryLinkResponse[]> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                clearInterval(interval);
                reject(new Error(`Timed out waiting for JDownloader job ${jobId} after 3 minutes`));
            }, 1000 * 60 * 3);

            const interval = setInterval(async () => {
                try {
                    const isCollecting = await this.userBot.jDownloader.isCollecting();
                    if (isCollecting) {
                        Logger.info(`JDownloader is still collecting for job ${jobId}`);
                        return;
                    }

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
            }, 1000 * 30);
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