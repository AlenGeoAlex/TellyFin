import {UserBot} from "@/userbot.js";
import {Api} from "telegram";
import {Logger} from "@/logger.js";

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

        if (!chatMessages || chatMessages.length === 0) return;
        const originalMessage = chatMessages[0];

        if (!originalMessage.text?.startsWith("Search results:")) {
            return;
        }

        const selection = parseInt(message.text);
        if (isNaN(selection)) {
            await this.userBot.interactionHandler.replyToMessage(message.chatId as any, message.id, "Please reply with a valid number.");
            return;
        }

        const lines = originalMessage.text.split("\n").filter(l => /^\d+\./.test(l));
        if (selection < 1 || selection > lines.length) {
            await this.userBot.interactionHandler.replyToMessage(message.chatId as any, message.id, "Selection out of range.");
            return;
        }

        const selectedLine = lines[selection - 1];
        const match = selectedLine.match(/^\d+\. (🎬 Movie|📺 Series): \*\*(.*?)\*\*(?: \((.*?)\))?$/);
        if (!match) {
            Logger.error(`Failed to parse selected line: ${selectedLine}`);
            return;
        }

        const type = match[1] === "🎬 Movie" ? "movie" : "series";
        const title = match[2];
        const year = match[3] ? parseInt(match[3]) : undefined;

        Logger.info(`User selected ${type}: ${title} (${year})`);

        await this.userBot.interactionHandler.replyToMessage(message.chatId as any, message.id, `Searching for ${title} in channels...`);

        // Search for file in channels
        const channels = this.userBot.environment.options.FORWARD_CHANNELS;
        let foundMessage: Api.Message | undefined;

        for (const channelId of channels) {
            Logger.info(`Searching in channel: ${channelId}`);
            const messages = await this.userBot.telegramClient.getMessages(channelId, {
                search: title,
                limit: 20
            });

            for (const msg of messages) {
                if (msg.file) {
                    // Simple check if title is in filename
                    if (msg.file.name?.toLowerCase().includes(title.toLowerCase())) {
                        foundMessage = msg;
                        break;
                    }
                }
            }
            if (foundMessage) break;
        }

        if (foundMessage) {
            Logger.info(`Found file in channel: ${foundMessage.file?.name}`);
            await this.userBot.interactionHandler.replyToMessage(message.chatId as any, message.id, `Found! Starting download: ${foundMessage.file?.name}`);
            await this.userBot.downloader.download(foundMessage, foundMessage.file!.name!);
        } else {
            await this.userBot.interactionHandler.replyToMessage(message.chatId as any, message.id, `Could not find any file for "${title}" in the monitored channels.`);
        }
    }

}