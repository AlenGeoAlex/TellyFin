import {Api} from "telegram";
import bigInt from "big-integer";
import {JDownloader} from "@/jdownloader.js";

export class DownloadTask {
    private readonly _chatId: bigInt.BigInteger | undefined;
    private readonly _messageId: number;
    private readonly _fileName: string;

    constructor(chatId: bigInt.BigInteger | undefined, messageId: number, fileName: string) {
        this._chatId = chatId;
        this._messageId = messageId;
        this._fileName = fileName;
    }

    public static fromMessage(message: Api.Message, fileName: string) : DownloadTask {
        return new DownloadTask(message.chatId, message.id, fileName);
    }

    public get chatId() : bigInt.BigInteger | undefined {
        return this._chatId;
    }

    public get messageId() : number {
        return this._messageId;
    }

    public get fileName() : string {
        return this._fileName;
    }

    public serializable() {
        return {
            chatId: this._chatId?.toString(),
            messageId: this._messageId,
            fileName: this._fileName
        };
    }

    public static deserialize(data: {chatId: string | undefined, messageId: number, fileName: string}): DownloadTask {
        return new DownloadTask(
            data.chatId ? bigInt(data.chatId) : undefined,
            data.messageId,
            data.fileName
        );
    }

    public toString() : string {
        return `DownloadTask(chatId=${this.chatId}, messageId=${this.messageId}, fileName=${this.fileName})`;
    }
}
export class DLCDownloadTask {
    private readonly _chatId: bigInt.BigInteger | undefined;
    private readonly _messageId: bigInt.BigInteger;
    private readonly _filePath: string;

    constructor(chatId: bigInt.BigInteger | undefined, messageId: bigInt.BigInteger, filePath: string) {
        this._chatId = chatId;
        this._messageId = messageId;
        this._filePath = filePath;
    }

    public static fromMessage(message: Api.Message, filePath: string): DLCDownloadTask {
        return new DLCDownloadTask(message.chatId, bigInt(message.id), filePath);
    }

    public get chatId(): bigInt.BigInteger | undefined {
        return this._chatId;
    }

    public get messageId(): bigInt.BigInteger {
        return this._messageId;
    }

    public get filePath(): string {
        return this._filePath;
    }

    public serializable() {
        return {
            chatId: this._chatId?.toString(),
            messageId: this._messageId.toString(),
            filePath: this._filePath
        };
    }

    public static deserialize(data: { chatId: string | undefined, messageId: string, filePath: string }): DLCDownloadTask {
        return new DLCDownloadTask(
            data.chatId ? bigInt(data.chatId) : undefined,
            bigInt(data.messageId),
            data.filePath
        );
    }

    public toString(): string {
        return `DLCDownloadTask(chatId=${this._chatId}, messageId=${this._messageId}, filePath=${this._filePath})`;
    }
}

export type LinkAvailability = 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'TEMP_UNKNOWN';

export interface Mirror {
    host: string;
    url: string;
    availability: LinkAvailability;
    bytesTotal?: number;
}

type LegacyQueryLinkTask = {
    host: string;
    name: string;
    availability: LinkAvailability;
    url: string;
};

/**
 * A single file from a DLC along with every mirror it is available on.
 */
export class MediaDownloadTask {
    private readonly _name: string;
    private readonly _mirrors: Mirror[];

    constructor(name: string, mirrors: Mirror[]) {
        this._name = name;
        this._mirrors = mirrors;
    }

    public static fromLink(link: JDownloader.QueryLink.QueryLinkResponse): MediaDownloadTask {
        return new MediaDownloadTask(link.name, [MediaDownloadTask.mirrorOf(link)]);
    }

    public static mirrorOf(link: JDownloader.QueryLink.QueryLinkResponse): Mirror {
        return {
            host: link.host,
            url: link.url,
            availability: link.availability,
            bytesTotal: link.bytesTotal
        };
    }

    public get name(): string { return this._name; }
    public get mirrors(): Mirror[] { return this._mirrors; }

    public serializable() {
        return {
            name: this._name,
            mirrors: this._mirrors
        };
    }

    public static deserialize(data: ReturnType<MediaDownloadTask['serializable']> | LegacyQueryLinkTask): MediaDownloadTask {
        // Entries queued before mirror support held a single JDownloader link
        if (!('mirrors' in data)) {
            return new MediaDownloadTask(data.name, [{
                host: data.host,
                url: data.url,
                availability: data.availability
            }]);
        }

        return new MediaDownloadTask(data.name, data.mirrors);
    }

    public toString(): string {
        return `MediaDownloadTask(name=${this._name}, mirrors=${this._mirrors.map(m => m.host).join(',')})`;
    }
}
