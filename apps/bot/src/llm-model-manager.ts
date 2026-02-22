import {
    getLlama,
    LlamaModel,
    LlamaContext,
    LlamaChatSession,
    LlamaJsonSchemaGrammar, Llama,
} from "node-llama-cpp";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import {Logger} from "@/logger.js";
import PQueue from "p-queue";
import {cleanFileName} from "@/utils.js";

export interface MediaInfo {
    candidateTitle: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    isMovie: boolean;
    quality: string | null;
    ext: string | null;
}

const MEDIA_INFO_SCHEMA = {
    type: "object",
    properties: {
        candidateTitle: { type: "string" },
        year: { type: ["number", "null"] },
        season: { type: ["number", "null"] },
        episode: { type: ["number", "null"] },
        isMovie: { type: "boolean" },
        quality: { type: ["string", "null"] },
    },
    required: ["candidateTitle", "year", "season", "episode", "isMovie", "quality"],
} as const;

export class LlamaModelManager {
    private model: LlamaModel | null = null;
    private context: LlamaContext | null = null;
    private instance: Llama | null = null;
    private modelPath: string;

    private queue = new PQueue({ concurrency: 1 });

    constructor(modelPath: string) {
        if (!modelPath) {
            throw new Error("Model path not specified.");
        }
        this.modelPath = modelPath;

        this.queue.on("idle", async () => {
            if (this.model) {
                Logger.log("Queue idle, unloading model to free memory.");
                await this.unload();
            }
        });
    }

    static async downloadModel(
        url: string,
        destPath: string,
        onProgress?: (percent: number) => void
    ): Promise<void> {
        if (fs.existsSync(destPath)) {
            Logger.log(`Model already exists at ${destPath}, skipping download.`);
            return;
        }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            const protocol = url.startsWith("https") ? https : http;

            const request = (redirectUrl: string) => {
                protocol.get(redirectUrl, (res) => {
                    if (
                        res.statusCode &&
                        res.statusCode >= 300 &&
                        res.statusCode < 400 &&
                        res.headers.location
                    ) {
                        request(res.headers.location);
                        return;
                    }

                    const total = parseInt(res.headers["content-length"] || "0", 10);
                    let downloaded = 0;

                    res.on("data", (chunk: Buffer) => {
                        downloaded += chunk.length;
                        if (total && onProgress) {
                            onProgress(Math.round((downloaded / total) * 100));
                        }
                    });

                    res.pipe(file);

                    file.on("finish", () => {
                        file.close();
                        Logger.info(`Model downloaded to ${destPath}`);
                        resolve();
                    });
                }).on("error", (err) => {
                    fs.unlinkSync(destPath);
                    reject(err);
                });
            };

            request(url);
        });
    }


    async load(): Promise<void> {
        if (this.model) {
            Logger.log("Model already loaded.");
            return;
        }

        if (!fs.existsSync(this.modelPath)) {
            throw new Error(
                `Model not found at ${this.modelPath}. Run LlamaModelManager.downloadModel() first.`
            );
        }

        Logger.log("Loading model...");
        this.instance = await getLlama();
        this.model = await this.instance.loadModel({ modelPath: this.modelPath });
        this.context = await this.model.createContext({ contextSize: 2048 });
        Logger.log("Model loaded.");
    }


    async unload(): Promise<void> {
        if (this.context) {
            await this.context.dispose();
            this.context = null;
        }
        if (this.model) {
            await this.model.dispose();
            this.model = null;
        }
        if (this.instance) {
            await this.instance.dispose();
            this.instance = null;
        }
        Logger.log("Model unloaded.");
    }


    async extractMediaInfo(filename: string): Promise<MediaInfo> {
        if (!this.model) {
            await this.load();
        }

        return await this.queue.add(() => this._extract(filename))
    }


    private async _extract(filename: string): Promise<MediaInfo> {
        if (!this.model || !this.context) {
            throw new Error("Model not loaded.");
        }

        const episodePattern = filename.match(/S\d{1,2}E\d{1,2}/i)?.[0] ?? null;

        let cleaned = cleanFileName(filename)
        cleaned = episodePattern && !cleaned.includes(episodePattern)
            ? `${cleaned} ${episodePattern}`
            : cleaned;
        Logger.log(`Extracting media info for: ${cleaned}`);

        const grammar = new LlamaJsonSchemaGrammar(this.instance!, MEDIA_INFO_SCHEMA);
        const session = new LlamaChatSession({
            contextSequence: this.context.getSequence(),
        });

        const prompt = `You are a media filename parser. Filenames use dots or underscores instead of spaces.

Rules:
- Dots and underscores are spaces, NOT separators between fields
- Strip any leading tags in square brackets like [MS], [TamilMV], [YTS] — these are site/group tags, not part of the title
- Strip any leading channel/site prefixes like "@TamilMV -", "www.site.com" etc.
- The title ends when you hit a 4-digit year (1900-2099) OR SxxExx pattern
- NEVER use resolution numbers (480, 720, 1080, 2160) as season/episode
- NEVER use audio channel numbers (5.1, 7.1, 2.0) as season/episode
- Season/episode ONLY comes from explicit patterns like S01E02, S01, E02, 1x02 — nothing else
- If no explicit SxxExx pattern exists, it is a movie
- Ignore everything after the year: codecs, bitrate, audio tags, source tags, group names, language names
- If season AND episode are both null after parsing, it is definitely a movie — set isMovie to true

Examples:
"Salt.Mango.Tree.2015.1080p.WEB-DL.x265" → title: "Salt Mango Tree", year: 2015, isMovie: true
"The.Glory.S01E03.1080p.BluRay" → title: "The Glory", season: 1, episode: 3, isMovie: false
"@TamilMV - Manjummel.Boys.2024.720p" → title: "Manjummel Boys", year: 2024, isMovie: true
"[MS] Paathirathri (2025) Malayalam WEB-DL 1080p" → title: "Paathirathri", year: 2025, isMovie: true
"Sausage_Party_2016_1080p_BluRay_Hindi_DDP_5_1" → title: "Sausage Party", year: 2016, isMovie: true
"Movie.Name.2020.S01E02.1080p" → title: "Movie Name", year: 2020, season: 1, episode: 2, isMovie: false
"Sausage_Party_2016_1080p_BluRay_Hindi_DDP_5_1" → title: "Sausage Party", year: 2016, season: null, episode: null, isMovie: true

Filename: "${cleaned}"

Return JSON only.`;

        const raw = await session.prompt(prompt, { grammar });
        Logger.log(`LLM response: ${raw}`);
        try {
            return JSON.parse(raw) as MediaInfo;
        } catch {
            throw new Error(`Failed to parse LLM response: ${raw}`);
        }
    }
}