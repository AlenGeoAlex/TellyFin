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

export class QueryLinkTask {
    private readonly _host: string;
    private readonly _name: string;
    private readonly _availability: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'TEMP_UNKNOWN';
    private readonly _packageUUID: number;
    private readonly _uuid: number;
    private readonly _url: string;
    private readonly _enabled: boolean;

    constructor(
        host: string,
        name: string,
        availability: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'TEMP_UNKNOWN',
        packageUUID: number,
        uuid: number,
        url: string,
        enabled: boolean
    ) {
        this._host = host;
        this._name = name;
        this._availability = availability;
        this._packageUUID = packageUUID;
        this._uuid = uuid;
        this._url = url;
        this._enabled = enabled;
    }

    public static fromResponse(response: JDownloader.QueryLink.QueryLinkResponse): QueryLinkTask {
        return new QueryLinkTask(
            response.host,
            response.name,
            response.availability,
            response.packageUUID,
            response.uuid,
            response.url,
            response.enabled
        );
    }

    public get host(): string { return this._host; }
    public get name(): string { return this._name; }
    public get availability(): 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'TEMP_UNKNOWN' { return this._availability; }
    public get packageUUID(): number { return this._packageUUID; }
    public get uuid(): number { return this._uuid; }
    public get url(): string { return this._url; }
    public get enabled(): boolean { return this._enabled; }

    public serializable() {
        return {
            host: this._host,
            name: this._name,
            availability: this._availability,
            packageUUID: this._packageUUID,
            uuid: this._uuid,
            url: this._url,
            enabled: this._enabled
        };
    }

    public static deserialize(data: ReturnType<QueryLinkTask['serializable']>): QueryLinkTask {
        return new QueryLinkTask(
            data.host,
            data.name,
            data.availability,
            data.packageUUID,
            data.uuid,
            data.url,
            data.enabled
        );
    }

    public toString(): string {
        return `QueryLinkTask(host=${this._host}, name=${this._name}, url=${this._url}, availability=${this._availability})`;
    }
}