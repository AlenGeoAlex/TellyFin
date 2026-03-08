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
            enabled: boolean
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