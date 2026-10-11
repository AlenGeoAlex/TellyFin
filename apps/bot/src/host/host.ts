import fs from "fs";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import type {ReadableStream} from "node:stream/web";

export interface HostDownloadResult {
    status: boolean
    error?: string
}

export interface IHost {

    /**
     * Display name used in logs and channel messages.
     */
    readonly name: string;

    /**
     * Whether this host can download links that JDownloader reported under the given host name.
     */
    canHandle(host: string): boolean;

    download(url: string, path: string) : Promise<HostDownloadResult>;

}

/**
 * Streams a fetch response body to disk, resolving only once the file is fully flushed.
 */
export async function writeResponseToFile(response: Response, outputPath: string): Promise<void> {
    if (!response.body) throw new Error('Response has no body');

    await pipeline(
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        fs.createWriteStream(outputPath)
    );
}
