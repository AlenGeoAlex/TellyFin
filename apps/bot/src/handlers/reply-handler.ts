import {UserBot} from "@/userbot.js";
import {Api} from "telegram";
import {Logger} from "@/logger.js";
import {FAILED_TO_FIND_MEDIA} from "@/constants/messages.js";

export class ReplyHandler {

    constructor(
        private readonly userBot: UserBot
    ) {
    }

    public async handleReply(message: Api.Message) {
        const replyToId = (message.replyTo as Api.MessageReplyHeader)?.replyToMsgId;
        if (!replyToId) return;

        const chatMessages = await this.userBot.telegramClient.getMessages(message.chatId, {
            ids: [replyToId]
        });

        if (!chatMessages || chatMessages.length === 0) {
            Logger.info("Ignoring reply to unidentified Message")
            return;
        }
        const botMessage = chatMessages[0];

        if(!botMessage.text?.startsWith("TELLYFIN RESPONSE"))
        {
            Logger.info("Ignoring reply to unidentified Message")
            return;
        }

        const originalFileMessageId = botMessage.replyToMsgId;
        if(!originalFileMessageId) {
            Logger.warn("Failed to locate original file message ID, skipping reply handler.")
            return;
        }

        const originalFileMessages = await this.userBot.telegramClient.getMessages(message.chatId, {
            ids: [originalFileMessageId]
        })

        if(!originalFileMessages || originalFileMessages.length === 0) {
            Logger.warn("Failed to locate original file message, skipping reply handler.")
            return;
        }

        const originalFileMessage = originalFileMessages[0]
        const providedText = message.text;

        const reply = await this.userBot.downloader.download(originalFileMessage, providedText)
        if(reply === 'NoContent') {
            Logger.warn("Failed to download file, skipping reply handler (This shouldn't happen).")
            return;
        }

        if(reply === 'NotFound') {
            this.userBot.interactionHandler.replyToMessage(message.chatId, message.id, FAILED_TO_FIND_MEDIA)
                .catch((err) => Logger.error(`Failed to reply to message: ${err}`))
        }
    }

}