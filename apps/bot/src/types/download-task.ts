import {Api} from "telegram";
import bigInt from "big-integer";

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