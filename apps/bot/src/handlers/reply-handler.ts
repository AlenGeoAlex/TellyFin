import {UserBot} from "@/userbot.js";
import {Api} from "telegram";

export class ReplyHandler {

    constructor(
        private readonly userBot: UserBot
    ) {
    }

    public async handleReply(messageId: Api.Message) {

    }

}