import {UserBot} from "@/userbot.js";
import {Logger} from "@/logger.js";
import {Api} from "telegram";
import path from "node:path";
import {ResolvedMedia} from "@/tmdb-client.js";
import PQueue from "p-queue";
import {Environment} from "@/types/env.type.js";
import {resolvePath} from "@/utils.js";
import * as fs from "node:fs";
import {createClient} from "@/client.js";
import {Error, Loading, Reacting, Success, ThumbsDown} from "@/constants/emoticon.js";

export class Downloader {
    private readonly downloaderQueue :PQueue;
    constructor(private readonly userBot: UserBot) {
        this.downloaderQueue = new PQueue({concurrency: Environment.get().options.DOWNLOAD_CONCURRENCY});
    }

    async download(message: Api.Message, fileName: string) : Promise<'NoContent' | 'NotFound' | 'Success'> {
        const video = message.document || message.video || message.file;
        if(!video)
        {
            this.userBot.interactionHandler.react(message.chatId, message.id, Error)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`))
            Logger.warn("No video in message, skipping")
            return 'NoContent';
        }

        this.userBot.interactionHandler.react(message.chatId, message.id, Loading)
            .catch((err) => Logger.error(`Failed to react to message: ${err}`))

        Logger.info(`Extracting media info for file: ${fileName}`)
        const response = await this.userBot.llmModelManager.extractMediaInfo(fileName);
        Logger.info(`Extracted media info: ${JSON.stringify(response)}`)
        const ext = path.extname(fileName).slice(1) || 'mkv';
        const resolved = await this.userBot.tmdbClient.resolve(response.candidateTitle, {
            isMovie: response.isMovie,
            year: response.year,
            season: response.season,
            episode: response.episode,
            fileExtension: ext
        });
        response.ext = ext;

        if(!resolved) {
            this.userBot.interactionHandler.react(message.chatId, message.id, ThumbsDown)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`))

            Logger.warn("Failed to resolve media, skipping download.")
            return 'NotFound';
        }

        Logger.info(`Resolved media: ${JSON.stringify(resolved)}`)

        this.downloaderQueue.add(() => this.queueDownload({
            message,
            resolvedMediaInfo: resolved
        }))

        return 'Success';
    }

    private async queueDownload(opts: {
        message: Api.Message,
        resolvedMediaInfo: ResolvedMedia
    }) {
        const fileTemplate = opts.resolvedMediaInfo.type === 'movie'
            ? Environment.get().options.MOVIE_PATH
            : Environment.get().options.SERIES_PATH;

        const downloadPath = path.join("/media", resolvePath(fileTemplate, opts.resolvedMediaInfo));
        fs.mkdirSync(path.dirname(downloadPath), { recursive: true });

        const tempPath = `${downloadPath}.tmp`;

        const client = createClient(true);
        this.userBot.interactionHandler.react(opts.message.chatId, opts.message.id, Reacting)
            .catch((err) => Logger.error(`Failed to react to message: ${err}`))

        try {
            await client.connect();

            let lastProgressAt = Date.now();
            const STALL_TIMEOUT = 3 * 60 * 1000;

            const stallChecker = setInterval(async () => {
                if (Date.now() - lastProgressAt > STALL_TIMEOUT) {
                    Logger.warn(`Download stalled: ${opts.resolvedMediaInfo.title}, aborting...`);
                    await client.disconnect().catch(() => {});
                }
            }, 10_000);

            try {
                await client.downloadMedia(opts.message.media!, {
                    outputFile: tempPath,
                    progressCallback: (downloaded: bigInt.BigInteger, total: bigInt.BigInteger) => {
                        lastProgressAt = Date.now();
                        const percent = total.greater(0)
                            ? Math.round(downloaded.multiply(100).divide(total).toJSNumber())
                            : 0;
                        Logger.info(`Downloading ${opts.resolvedMediaInfo.title} (${percent}%)`);
                    },
                });
            } finally {
                clearInterval(stallChecker);
            }

            fs.renameSync(tempPath, downloadPath);
            Logger.info(`Saved: ${downloadPath}`);
            this.userBot.interactionHandler.react(opts.message.chatId, opts.message.id, Success)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`))
        } catch (err) {
            this.userBot.interactionHandler.react(opts.message.chatId, opts.message.id, Error)
                .catch((err) => Logger.error(`Failed to react to message: ${err}`))
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            Logger.error(`Failed to download ${opts.resolvedMediaInfo.title}: ${err}`);
            throw err;

        } finally {
            await client.disconnect().catch(() => {});
        }
    }
}