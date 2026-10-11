import {HostDownloadResult, IHost} from "@/host/host.js";
import {JDownloader} from "@/jdownloader.js";
import {Logger} from "@/logger.js";
import fs from "fs";
import path from "node:path";

const POLL_INTERVAL = 5 * 1000;
const RESOLVE_TIMEOUT = 3 * 60 * 1000;
const CAPTCHA_TIMEOUT = 2 * 60 * 1000;
const STALL_TIMEOUT = 10 * 60 * 1000;

/**
 * Catch-all host: hands a single mirror URL to JDownloader, waits for it to finish
 * and moves the result out of JDownloader's output folder.
 */
export class JDownloaderHost implements IHost {

    readonly name = 'JDownloader';

    constructor(
        private readonly jDownloader: JDownloader,
        // Output folder as seen by the bot, and the same folder as seen by the JDownloader container
        private readonly localOutputPath: string,
        private readonly containerOutputPath: string
    ) {}

    canHandle(_host: string): boolean {
        return true;
    }

    async download(url: string, outputPath: string): Promise<HostDownloadResult> {
        const token = `tellyfin-${Date.now()}`;
        const localDir = path.join(this.localOutputPath, '.incoming', token);
        const containerDir = path.posix.join(this.containerOutputPath, '.incoming', token);

        let linkIds: number[] = [];

        try {
            const job = await this.jDownloader.addUrls(url, token, containerDir);
            const grabbed = await this.waitForLinkGrabber(job.id);
            if (grabbed.length === 0) {
                return { status: false, error: 'JDownloader could not resolve the link' };
            }

            const online = grabbed.filter(link => link.availability !== 'OFFLINE');
            if (online.length === 0) {
                return { status: false, error: 'JDownloader reports the link as offline' };
            }

            linkIds = online.map(link => link.uuid);
            await this.jDownloader.moveToDownloadList(linkIds);
            await this.jDownloader.startDownloads()
                .catch(err => Logger.warn(`Failed to start JDownloader downloads: ${err}`));

            const failure = await this.waitForDownload(linkIds);
            if (failure) return { status: false, error: failure };

            const file = this.findLargestFile(localDir);
            if (!file) {
                return { status: false, error: `JDownloader finished but no file was found in ${localDir}` };
            }

            this.moveFile(file, outputPath);
            return { status: true };
        } finally {
            if (linkIds.length > 0) {
                await this.jDownloader.removeDownloadLinks(linkIds)
                    .catch(err => Logger.warn(`Failed to remove JDownloader download links: ${err}`));
                await this.jDownloader.removeLinkGrabberLinks(linkIds)
                    .catch(err => Logger.warn(`Failed to remove JDownloader link grabber links: ${err}`));
            }
            fs.rmSync(localDir, { recursive: true, force: true });
        }
    }

    private async waitForLinkGrabber(jobId: number) {
        const deadline = Date.now() + RESOLVE_TIMEOUT;
        while (Date.now() < deadline) {
            await this.sleep(POLL_INTERVAL);
            const response = await this.jDownloader.queryLink(jobId);
            const links = response.data;
            if (links.length > 0 && links.every(link => link.availability !== 'UNKNOWN')) {
                return links;
            }
        }
        return [];
    }

    /**
     * Polls the download list until every link finished. Returns an error message on failure.
     */
    private async waitForDownload(linkIds: number[]): Promise<string | undefined> {
        let lastProgress = -1;
        let lastProgressAt = Date.now();
        let captchaSince: number | undefined;

        while (true) {
            await this.sleep(POLL_INTERVAL);

            const links = (await this.jDownloader.queryDownloadLinks())
                .filter(link => linkIds.includes(link.uuid));

            if (links.length === 0) return 'Link disappeared from the JDownloader download list';
            if (links.every(link => link.finished)) return undefined;

            const skipped = links.find(link => link.skipped);
            if (skipped) return `JDownloader skipped the link: ${skipped.status ?? 'unknown reason'}`;

            const status = links.map(link => link.status).filter(Boolean).join(', ');

            if (/captcha/i.test(status)) {
                captchaSince ??= Date.now();
                if (Date.now() - captchaSince > CAPTCHA_TIMEOUT) return `JDownloader is stuck on a captcha (${status})`;
            } else {
                captchaSince = undefined;
            }

            const progress = links.reduce((total, link) => total + (link.bytesLoaded ?? 0), 0);
            if (progress !== lastProgress) {
                lastProgress = progress;
                lastProgressAt = Date.now();
            } else if (Date.now() - lastProgressAt > STALL_TIMEOUT) {
                return `JDownloader made no progress for ${STALL_TIMEOUT / 60000} minutes (${status || 'no status'})`;
            }
        }
    }

    private findLargestFile(dir: string): string | undefined {
        if (!fs.existsSync(dir)) return undefined;

        let largest: { file: string, size: number } | undefined;
        for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || entry.name.endsWith('.part')) continue;
            const file = path.join(entry.parentPath, entry.name);
            const size = fs.statSync(file).size;
            if (!largest || size > largest.size) largest = { file, size };
        }
        return largest?.file;
    }

    private moveFile(source: string, destination: string) {
        try {
            fs.renameSync(source, destination);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
            fs.copyFileSync(source, destination);
            fs.unlinkSync(source);
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
