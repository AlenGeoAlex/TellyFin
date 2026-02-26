import {UserBot} from "@/userbot.js";
import {Logger} from "@/logger.js";
import {Api} from "telegram";
import path from "node:path";
import {Environment} from "@/types/env.type.js";
import {resolvePath} from "@/utils.js";
import * as fs from "node:fs";
import {createClient} from "@/client.js";
import {Error, Loading, Success, ThumbsDown, ThumbsUp} from "@/constants/emoticon.js";
import {FAILED_TO_FIND_MEDIA} from "@/constants/messages.js";
import bigInt from "big-integer";
import {PersistentQueue} from "@/persistent-queue.js";
import {DownloadTask} from "@/types/download-task.js";

export class Downloader {
    private readonly downloaderQueue: PersistentQueue<ReturnType<DownloadTask['serializable']>>;

    constructor(private readonly userBot: UserBot) {
        this.downloaderQueue = new PersistentQueue(
            (data) => this.processTask(DownloadTask.deserialize(data)),
            {
                concurrency: Environment.get().options.DOWNLOAD_CONCURRENCY,
                dbPath: './downloads-queue.json'
            }
        );
    }

    public get pending(): number {
        return this.downloaderQueue.size;
    }

    public pauseQueue(): void {
        this.downloaderQueue.pause();
    }

    public async queueOnIdle(): Promise<void> {
        return this.downloaderQueue.onIdle();
    }

    public async download(message: Api.Message, fileName: string): Promise<'NoContent' | 'Success'> {
        const video = message.document || message.video || message.file;
        if (!video) {
            this.userBot.interactionHandler.react(message.chatId, message.id, Error)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));
            Logger.warn("No video in message, skipping");
            return 'NoContent';
        }

        const task = DownloadTask.fromMessage(message, fileName);
        this.downloaderQueue.push(
            `${task.chatId?.toString()}-${task.messageId}`,
            task.serializable()
        );
        Logger.info(`Queued task: ${task}`);

        return 'Success';
    }

    private async processTask(task: DownloadTask): Promise<void> {
        const client = this.userBot.telegramClient;
        Logger.info(`Processing task: ${task}`);

        let tempPath: string | undefined;

        try {

            const messages = await client.getMessages(task.chatId, {ids: [task.messageId]});
            const message = messages[0];

            if (!message) {
                Logger.warn(`Message ${task.messageId} not found, skipping.`);
                return;
            }

            this.userBot.interactionHandler.react(message.chatId, message.id, ThumbsUp)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));
            Logger.info(`Extracting media info for file: ${task.fileName}`);
            const response = await this.userBot.llmModelManager.extractMediaInfo(task.fileName);
            Logger.info(`Extracted media info: ${JSON.stringify(response)}`);

            const ext = path.extname(task.fileName).slice(1) || 'mkv';
            const resolved = await this.userBot.tmdbClient.resolve(response.candidateTitle, {
                isMovie: response.isMovie,
                year: response.year,
                season: response.season,
                episode: response.episode,
                fileExtension: ext
            });

            if (!resolved) {
                this.userBot.interactionHandler.react(task.chatId, task.messageId, ThumbsDown)
                    .catch((err) => Logger.error(`Failed to react to message: ${err}`));
                this.userBot.interactionHandler.replyToMessage(task.chatId, task.messageId, FAILED_TO_FIND_MEDIA)
                    .catch((err) => Logger.error(`Failed to reply to message: ${err}`));
                Logger.warn(`Failed to resolve media for task: ${task}, skipping.`);
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
            fs.mkdirSync(path.dirname(downloadPath), {recursive: true});

            tempPath = `${downloadPath}.tmp`;

            this.userBot.interactionHandler.react(task.chatId, task.messageId, Loading)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));

            let lastProgressAt = Date.now();
            const STALL_TIMEOUT = 3 * 60 * 1000;

            const stallChecker = setInterval(async () => {
                if (Date.now() - lastProgressAt > STALL_TIMEOUT) {
                    Logger.warn(`Download stalled: ${resolved.title}, aborting...`);
                    await client.disconnect().catch(() => {});
                    await client.destroy().catch(() => {});
                }
            }, 10_000);

            try {
                await client.downloadMedia(message.media!, {
                    outputFile: tempPath,
                    progressCallback: (downloaded: bigInt.BigInteger, total: bigInt.BigInteger) => {
                        lastProgressAt = Date.now();
                        const percent = total.greater(0)
                            ? Math.round(downloaded.multiply(100).divide(total).toJSNumber())
                            : 0;
                        Logger.info(`Downloading ${resolved.title} (${percent}%)`);
                    },
                });
            } finally {
                clearInterval(stallChecker);
            }

            fs.renameSync(tempPath, downloadPath);
            Logger.info(`Saved: ${downloadPath}`);
            await this.userBot.jellyfinManager.tryRefresh();
            this.userBot.interactionHandler.react(task.chatId, task.messageId, Success)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));

        } catch (err) {
            this.userBot.interactionHandler.react(task.chatId, task.messageId, Error)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`));
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            Logger.error(`Failed to process task ${task}: ${err}`);
            throw err;

        } finally {
            await client.disconnect().catch(() => {});
            await client.destroy().catch(() => {});
        }
    }
}