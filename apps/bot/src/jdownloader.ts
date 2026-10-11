import fs from "fs";
import {Logger} from "@/logger.js";
import path from "node:path";
import * as url from "node:url";
import {Environment} from "@/types/env.type.js";

export class JDownloader {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Clears the link grabber list in JDownloader.
     * Sends a POST request to the appropriate endpoint and processes the response.
     * Logs success or failure messages based on the result of the operation.
     *
     * @return {Promise<boolean>} A promise that resolves to `true` if the link grabber list was successfully cleared,
     * or `false` if the operation failed.
     */
    async clearList(): Promise<boolean>{
        const response = await fetch(this.generateCallableUrl(JDownloader.ClearList.CLEAR_LINK_GRABBER), {
            method: 'POST',
        });

        if(response.ok){
            const responseData = await response.json() as JDownloader.ClearList.ClearListResponse;
            console.log("Cleared link grabber list", responseData.data)
            return responseData.data;
        }

        Logger.error("Failed to clear link grabber list. Status code: " + response.status + "")
        const errorResponse = await response.text();
        Logger.error(errorResponse)
        return false;
    }

    public async queryLink(jobId: number){
        const query = {
            jobUUIDs: [jobId],
            status: true,
            availability: true,
            "url": true,
            "name": true,
            "size": true,
            "comment": true,
            "enabled": true,
            "host": true,
            "bytesTotal": true,
            maxResults: 1000,
            startAt: 0
        }

        const url = new URL(
            JDownloader.QueryLink.QUERY_LINK, this.baseUrl
        )

        Logger.info("Querying link: " + url.toString())

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query)
        })

        if(!response.ok){
            const text = await response.text();
            throw new Error(
                `Failed to query link. Status code: ${response.status} - ${text}`
            )
        }

        return await response.json() as JDownloader.JDownloaderResponse<JDownloader.QueryLink.QueryLinkResponse[]>;
    }

    public async addDlcForLinkGrab(
        data: JDownloader.AddLink.LinkInput
    ) {
        if (!fs.existsSync(data.path)) throw new Error('Failed to find dlc file!')

        const sharedDir = Environment.get().options.JDOWNLOADER_DLC_PATH!;
        const filename = `${Date.now()}${path.extname(data.path)}`;
        const tmpPath = path.join(sharedDir, filename);

        fs.mkdirSync(sharedDir, { recursive: true });
        fs.copyFileSync(data.path, tmpPath);
        Logger.info(`Copied DLC to ${tmpPath}`);

        const containerPath = `/shared/dlcs/${filename}`;
        const fileUrl = url.pathToFileURL(containerPath).toString();
        Logger.info(`File URL: ${fileUrl}`);


        return await this.addLink({
            autostart: false,
            packageName: "downloaded_dlc",
            links: fileUrl,
            destinationFolder: '/tmp/jdownloader/dlcs',
            comment: '',
            priority: JDownloader.Constants.Priority.Default,
            downloadPassword: '',
            extractPassword: '',
            overwritePackagizerRules: true,
            sourceUrl: '',
            dataURLs: [],
        });
    }

    /**
     * Adds plain URLs to the link grabber with a dedicated destination folder.
     */
    public async addUrls(links: string, packageName: string, destinationFolder: string) {
        return await this.addLink({
            autostart: false,
            packageName,
            links,
            destinationFolder,
            comment: '',
            priority: JDownloader.Constants.Priority.Default,
            downloadPassword: '',
            extractPassword: '',
            overwritePackagizerRules: true,
            sourceUrl: '',
            dataURLs: [],
        });
    }

    public async moveToDownloadList(linkIds: number[], packageIds: number[] = []) {
        // The deprecated API only accepts these as query-string params, JSON bodies fail with a 500
        await this.getWithIds(JDownloader.LinkGrabber.MOVE_TO_DOWNLOAD_LIST, linkIds, packageIds);
    }

    public async removeLinkGrabberLinks(linkIds: number[], packageIds: number[] = []) {
        await this.getWithIds(JDownloader.LinkGrabber.REMOVE_LINKS, linkIds, packageIds);
    }

    public async startDownloads() {
        const response = await fetch(this.generateCallableUrl(JDownloader.Downloads.START));
        if (!response.ok)
            throw new Error(`Failed to start downloads. Status code: ${response.status} - ${await response.text()}`);
    }

    public async queryDownloadLinks() {
        const query = {
            host: true,
            name: true,
            status: true,
            bytesLoaded: true,
            bytesTotal: true,
            speed: true,
            finished: true,
            running: true,
            skipped: true,
            enabled: true,
            maxResults: 1000,
            startAt: 0
        };

        const response = await fetch(this.generateCallableUrl(JDownloader.Downloads.QUERY_LINKS), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query)
        });

        if (!response.ok)
            throw new Error(`Failed to query download links. Status code: ${response.status} - ${await response.text()}`);

        const responseData = await response.json() as JDownloader.JDownloaderResponse<JDownloader.Downloads.DownloadLink[]>;
        return responseData.data;
    }

    public async removeDownloadLinks(linkIds: number[], packageIds: number[] = []) {
        await this.getWithIds(JDownloader.Downloads.REMOVE_LINKS, linkIds, packageIds);
    }

    private async getWithIds(endpoint: string, linkIds: number[], packageIds: number[]) {
        const url = new URL(this.generateCallableUrl(endpoint));
        url.searchParams.set('linkIds', JSON.stringify(linkIds));
        url.searchParams.set('packageIds', JSON.stringify(packageIds));

        const response = await fetch(url.toString());
        if (!response.ok)
            throw new Error(`Failed to call ${endpoint}. Status code: ${response.status} - ${await response.text()}`);
    }

    private async addLink(
        request: JDownloader.AddLink.AddLinkRequest
    ): Promise<JDownloader.AddLink.AddLinkResponse> {

        const query = {
            assignJobID: true,
            autostart: request.autostart,
            sourceUrl: 'source.dlc',
            links: request.links,
            packageName: request.packageName,
            dataURLs: request.dataURLs,
            ...(request.destinationFolder && {
                destinationFolder: request.destinationFolder
            })
        };

        const url = new URL(
            JDownloader.AddLink.ADD_LINK, this.baseUrl
        );

        const response = await fetch(url.toString(), {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(
                `Failed to add link. Status code: ${response.status} - ${text}`
            );
        }

        const responseData = await response.json() as JDownloader.JDownloaderResponse<JDownloader.AddLink.AddLinkResponse>;
        Logger.log(`Added link:  ${responseData.data.id}`);
        return responseData.data;
    }

    private generateCallableUrl(path: string) : string {
        return `${this.baseUrl}${path}`;
    }

    public async queryLinkCrawlingJob(jobId: number) {
        const query = {
            jobIds: [jobId],
        }

        const response = await fetch(`${this.generateCallableUrl('/linkgrabberv2/queryLinkCrawlerJobs')}?query=${JSON.stringify(query)}`, {})
        console.log(await response.text())
    }

    public async isCollecting(){
        const response = await fetch(`${this.generateCallableUrl(JDownloader.IsCollecting.IS_COLLECTING)}`)

        if(!response.ok)
            throw new Error("Failed to check if link grabber is collecting. Status code: " + response.status + "")

        return await response.json() as boolean;
    }
}

export namespace JDownloader {

    export interface JDownloaderResponse<TOutput> {
        data: TOutput;
    }

    export namespace IsCollecting {
        export const IS_COLLECTING = "/linkgrabberv2/isCollecting";
    }

    export namespace ClearList {

        export const CLEAR_LINK_GRABBER = "/linkgrabberv2/clearList";

        export interface ClearListRequest {}

        export interface ClearListResponse {
            data: boolean;
        }
    }

    export namespace AddLink {
        export const ADD_LINK = "/linkgrabberv2/addLinks";

        export interface AddLinkRequest {
            assignJobID?: boolean ;
            autoExtract?: boolean;
            autostart?: boolean;
            comment: string;
            dataURLs: string[];
            deepDecrypt?: boolean;
            destinationFolder: string;
            downloadPassword: string
            extractPassword: string
            links: string;
            overwritePackagizerRules?: boolean;
            packageName: string;
            sourceUrl: string
            priority: Constants.Priority;
        }

        export interface AddLinkResponse {
            id: number;
        }

        export type LinkInput =
            | { path: string }

    }

    export namespace LinkGrabber {
        export const MOVE_TO_DOWNLOAD_LIST = "/linkgrabberv2/moveToDownloadlist";
        export const REMOVE_LINKS = "/linkgrabberv2/removeLinks";
    }

    export namespace QueryLink {
        export const QUERY_LINK = "/linkgrabberv2/queryLinks";

        export interface QueryLinkRequest {
            jobUUIDs: string[] | number[];
            status: boolean;
            maxResults: number;
            startAt: number
        }

        export interface QueryLinkResponse {
            host: string;
            name: string;
            availability: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'TEMP_UNKNOWN',
            packageUUID: number;
            uuid: number,
            url: string;
            enabled: boolean;
            bytesTotal?: number;
        }

    }

    export namespace Downloads {
        export const QUERY_LINKS = "/downloadsV2/queryLinks";
        export const REMOVE_LINKS = "/downloadsV2/removeLinks";
        export const START = "/downloadcontroller/start";

        export interface DownloadLink {
            uuid: number;
            packageUUID: number;
            host: string;
            name: string;
            status?: string;
            bytesLoaded?: number;
            bytesTotal?: number;
            speed?: number;
            finished?: boolean;
            running?: boolean;
            skipped?: boolean;
            enabled?: boolean;
        }
    }

    export namespace Constants {
        export enum Priority {
            Highest = 'HIGHEST',
            Higher = 'HIGHER',
            High = 'HIGH',
            Default = 'DEFAULT',
            Low = 'LOW',
            Lower = 'LOWER',
            Lowest = 'LOWEST',
        }
    }
}