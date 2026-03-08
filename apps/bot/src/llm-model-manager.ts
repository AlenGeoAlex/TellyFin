import {
    getLlama,
    LlamaModel,
    LlamaContext,
    LlamaChatSession,
    Llama,
} from "node-llama-cpp";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { Logger } from "@/logger.js";
import PQueue from "p-queue";
import { cleanFileName } from "@/utils.js";

export interface MediaInfo {
    candidateTitle: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    isMovie: boolean;
    quality: string | null;
    ext: string | null;
}

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

        return await this.queue.add(() => this._extract(filename));
    }

    // --- Regex helpers ---

    private static extractYear(filename: string): number | null {
        // Match a 4-digit year not adjacent to other digits
        const match = filename.match(/(?<!\d)(19|20)\d{2}(?!\d)/);
        return match ? parseInt(match[0]) : null;
    }

    private static extractSeasonEpisode(filename: string): { season: number | null; episode: number | null } {
        const match = filename.match(/S(\d{1,2})E(\d{1,2})/i);
        if (match) {
            return { season: parseInt(match[1]), episode: parseInt(match[2]) };
        }
        // Also handle 1x02 format
        const altMatch = filename.match(/(?<!\d)(\d{1,2})x(\d{1,2})(?!\d)/i);
        if (altMatch) {
            return { season: parseInt(altMatch[1]), episode: parseInt(altMatch[2]) };
        }
        return { season: null, episode: null };
    }

    private static extractQuality(filename: string): string | null {
        const match = filename.match(/\b(480p|720p|1080p|2160p|4K)\b/i);
        return match ? match[1].toLowerCase() : null;
    }

    private static extractExt(filename: string): string | null {
        const match = filename.match(/\.(\w{2,4})$/);
        return match ? match[1].toLowerCase() : null;
    }

    private static stripNoise(filename: string): string {
        return filename
            // Remove file extension
            .replace(/\.\w{2,4}$/, "")
            // Remove leading site/group tags: [TAG], @Site -, www.site.com -
            .replace(/^\[.*?\]\s*/g, "")
            .replace(/^@\S+\s*-\s*/g, "")
            .replace(/^www\.\S+\s*-?\s*/gi, "")
            // Remove everything from year or SxxExx onwards
            .replace(/(?<!\d)(19|20)\d{2}(?!\d).*$/i, "")
            .replace(/S\d{1,2}E\d{1,2}.*/i, "")
            .replace(/\d{1,2}x\d{1,2}.*/i, "")
            // Replace dots and underscores with spaces
            .replace(/[._]/g, " ")
            // Collapse multiple spaces
            .replace(/\s+/g, " ")
            .trim();
    }

    private async _extract(filename: string): Promise<MediaInfo> {
        if (!this.model || !this.context) {
            throw new Error("Model not loaded.");
        }

        Logger.log(`Extracting media info for: ${filename}`);

        // Extract structured fields with regex — no LLM needed
        const year = LlamaModelManager.extractYear(filename);
        const { season, episode } = LlamaModelManager.extractSeasonEpisode(filename);
        const quality = LlamaModelManager.extractQuality(filename);
        const ext = LlamaModelManager.extractExt(filename);
        const isMovie = season === null && episode === null;

        // Strip noise to give LLM only the title portion
        const titleHint = LlamaModelManager.stripNoise(filename);

        // LLM only cleans up the title
        const session = new LlamaChatSession({
            contextSequence: this.context.getSequence(),
        });

        const prompt = `Extract the movie or TV show title from this text. 
The text has already had technical tags, years, and episode codes removed.
Return only the clean title — no punctuation, no explanation, no extra words.

Examples:
"Salt Mango Tree" → Salt Mango Tree
"The Glory" → The Glory
"Manjummel Boys" → Manjummel Boys
"Girl From Nowhere The Reset" → Girl From Nowhere The Reset

Text: "${titleHint}"`;

        const rawTitle = await session.prompt(prompt, { temperature: 0 });
        const candidateTitle = rawTitle.trim().replace(/^["']|["']$/g, "");

        Logger.log(`LLM title: ${candidateTitle}`);

        const result: MediaInfo = {
            candidateTitle,
            year,
            season,
            episode,
            isMovie,
            quality,
            ext,
        };

        Logger.log(`Extracted media info: ${JSON.stringify(result)}`);
        return result;
    }
}