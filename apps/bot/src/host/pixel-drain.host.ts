import {IHost} from "@/host/host.js";
import {Environment} from "@/types/env.type.js";
import fs from "fs";

export class PixelDrainHost implements IHost {

    async download(url: string, outputPath: string): Promise<{
        status: boolean
        error?: string
    }> {
        const pixelDrainApiKey = Environment.get().options.PIXEL_DRAIN_API_KEY;
        if (!pixelDrainApiKey) {
            return { status: false, error: "PixelDrain API key not found" };
        }

        const fileId = this.extractFileId(url);
        if (!fileId) {
            return { status: false, error: `Failed to extract file ID from URL: ${url}` };
        }

        const downloadUrl = `https://pixeldrain.com/api/file/${fileId}?download`;

        const response = await fetch(downloadUrl, {
            headers: {
                Authorization: `Basic ${Buffer.from(`:${pixelDrainApiKey}`).toString('base64')}`
            }
        });

        if (!response.ok) {
            return { status: false, error: `PixelDrain returned ${response.status}: ${await response.text()}` };
        }

        const fileStream = fs.createWriteStream(outputPath);
        const reader = response.body!.getReader();

        await new Promise<void>((resolve, reject) => {
            const pump = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) { fileStream.end(); resolve(); return; }
                        fileStream.write(value);
                    }
                } catch (err) {
                    fileStream.destroy();
                    reject(err);
                }
            };
            pump();
        });

        return { status: true };
    }

    private extractFileId(url: string): string | null {
        try {
            const parsed = new URL(url);
            // handles /u/{id} and /api/file/{id}
            const match = parsed.pathname.match(/\/(?:u|api\/file)\/([a-zA-Z0-9]+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }
}