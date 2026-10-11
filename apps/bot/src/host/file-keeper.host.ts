import {HostDownloadResult, IHost, writeResponseToFile} from "@/host/host.js";
import {Logger} from "@/logger.js";
import {Environment} from "@/types/env.type.js";

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * FileKeeper (XFileSharing based). With FILEKEEPER_API_KEY the API is asked for a direct link first,
 * otherwise (or when that fails) the free flow is used:
 * GET file page -> wait for countdown -> POST op=download2 -> 302 to a direct CDN link.
 */
export class FileKeeperHost implements IHost {

    readonly name = 'filekeeper.net';

    canHandle(host: string): boolean {
        return host === 'filekeeper.net';
    }

    async download(url: string, outputPath: string): Promise<HostDownloadResult> {
        const apiKey = Environment.get().options.FILEKEEPER_API_KEY;
        if (apiKey) {
            const directUrl = await this.getApiDirectLink(url, apiKey)
                .catch(err => {
                    Logger.warn(`FileKeeper API direct link failed, falling back to free download: ${err}`);
                    return undefined;
                });

            if (directUrl) {
                const fileResponse = await fetch(directUrl, { headers: { 'User-Agent': USER_AGENT } });
                if (fileResponse.ok) {
                    await writeResponseToFile(fileResponse, outputPath);
                    return { status: true };
                }
                Logger.warn(`FileKeeper API link returned ${fileResponse.status}, falling back to free download`);
            }
        }

        return this.freeDownload(url, outputPath);
    }

    private async getApiDirectLink(url: string, apiKey: string): Promise<string> {
        const fileCode = this.extractFileCode(url);
        if (!fileCode) throw new Error(`Failed to extract file code from URL: ${url}`);

        const apiUrl = new URL('https://filekeeper.net/api/file/direct_link');
        apiUrl.searchParams.set('key', apiKey);
        apiUrl.searchParams.set('file_code', fileCode);

        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': USER_AGENT, 'Authorization': `Bearer ${apiKey}` }
        });
        const body = await response.json() as { status: number, msg?: string, result?: { url?: string } };

        if (body.status !== 200 || !body.result?.url) {
            throw new Error(`API returned ${body.status}: ${body.msg ?? 'no download url'}`);
        }
        return body.result.url;
    }

    private extractFileCode(url: string): string | null {
        try {
            // handles /{code}, /{code}/{file name} and /preview/{code}
            const segments = new URL(url).pathname.split('/').filter(Boolean);
            const code = segments[0] === 'preview' ? segments[1] : segments[0];
            return code && /^[a-z0-9]+$/i.test(code) ? code : null;
        } catch {
            return null;
        }
    }

    private async freeDownload(url: string, outputPath: string): Promise<HostDownloadResult> {
        const cookies = new Map<string, string>();

        const { response: pageResponse, url: pageUrl } = await this.fetchWithCookies(url, cookies);

        if (!pageResponse.ok) {
            return { status: false, error: `FileKeeper page returned ${pageResponse.status}` };
        }

        const html = await pageResponse.text();
        const countdownTag = html.match(/<div[^>]*id="download-countdown"[^>]*>/)?.[0];
        if (!countdownTag) {
            return { status: false, error: 'FileKeeper download form not found (file removed or page changed)' };
        }

        const attr = (name: string) => countdownTag.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] ?? '';

        if (attr('has-captcha') === 'true') return { status: false, error: 'FileKeeper requires a captcha' };
        if (attr('has-password') === 'true') return { status: false, error: 'FileKeeper file is password protected' };

        const code = attr('code');
        if (!code) return { status: false, error: 'FileKeeper file code not found' };

        const countdown = parseInt(attr('countdown'), 10) || 5;
        Logger.info(`FileKeeper: waiting ${countdown}s before requesting ${code}`);
        await new Promise(resolve => setTimeout(resolve, (countdown + 1) * 1000));

        const formResponse = await fetch(pageUrl, {
            method: 'POST',
            redirect: 'manual',
            headers: {
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': pageUrl,
                'Cookie': this.cookieHeader(cookies)
            },
            body: new URLSearchParams({
                op: 'download2',
                id: code,
                rand: attr('rand'),
                referer: attr('referer'),
                method_free: attr('method'),
                down_direct: '1'
            })
        });

        const directUrl = formResponse.headers.get('location');
        if (!directUrl) {
            return { status: false, error: `FileKeeper did not return a download link (HTTP ${formResponse.status})` };
        }

        const fileResponse = await fetch(new URL(directUrl, pageUrl), {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!fileResponse.ok) {
            return { status: false, error: `FileKeeper download returned ${fileResponse.status}` };
        }

        await writeResponseToFile(fileResponse, outputPath);
        return { status: true };
    }

    /**
     * The file page redirects to /download and relies on the session cookie set along the way,
     * fetch drops cookies between redirects so they are followed manually.
     */
    private async fetchWithCookies(url: string, cookies: Map<string, string>, maxRedirects = 5) {
        let current = url;
        for (let i = 0; i <= maxRedirects; i++) {
            const response = await fetch(current, {
                redirect: 'manual',
                headers: { 'User-Agent': USER_AGENT, 'Cookie': this.cookieHeader(cookies) }
            });
            this.collectCookies(response, cookies);

            const location = response.headers.get('location');
            if (response.status < 300 || response.status >= 400 || !location) {
                // Keep track of where we ended up, the form posts back to that page
                return { response, url: current };
            }
            current = new URL(location, current).toString();
        }
        throw new Error(`FileKeeper redirected more than ${maxRedirects} times`);
    }

    private collectCookies(response: Response, cookies: Map<string, string>) {
        for (const cookie of response.headers.getSetCookie()) {
            const [pair] = cookie.split(';');
            const index = pair.indexOf('=');
            if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
    }

    private cookieHeader(cookies: Map<string, string>) {
        return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    }
}
