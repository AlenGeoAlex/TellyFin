import {HostDownloadResult, IHost, writeResponseToFile} from "@/host/host.js";
import {Environment} from "@/types/env.type.js";

export class PixelDrainHost implements IHost {

    readonly name = 'pixeldrain.com';

    canHandle(host: string): boolean {
        return host === 'pixeldrain.com';
    }

    async download(url: string, outputPath: string): Promise<HostDownloadResult> {
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

        await writeResponseToFile(response, outputPath);
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
