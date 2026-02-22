import {NewMessageEvent} from "telegram/events/index.js";
import {UserBot} from "@/userbot.js";
import {Api} from "telegram";
import {Logger} from "@/logger.js";
import {Environment} from "@/types/env.type.js";

export const messageHandler = async (event: NewMessageEvent, options: {
    userBot: UserBot
}) => {
    const message = event.message;
    const isValidSender = await validateSender(message, options.userBot);
    if(!isValidSender.isValid) return;

    if(message.media instanceof Api.MessageMediaEmpty)
    {
        Logger.warn("No media in message, skipping")
        return;
    }

    const text = message.text;
    if(message.file){
        const downloaderResponse = await options.userBot.downloader.download(message, message.file.name);
        if(downloaderResponse === 'NoContent') {
            Logger.warn("No content in downloader response, skipping")
            return;
        }

        if(downloaderResponse === 'NotFound') {
            Logger.warn("Media not found in downloader response, skipping")
            return;
        }

        Logger.info(`Downloader response: ${downloaderResponse}`)
    } else if(!message.media) {
        const searcherResponse = await options.userBot.searcher.search(text);
        Logger.info(`Searcher response: ${searcherResponse}`)
        return;
    }
};

async function validateSender(message: Api.Message, userBot: UserBot) : Promise<{
    isValid: boolean
    source: 'user' | 'channel' | undefined
}>{

    // Check if I myself saved the message, if so, accept, else don't even bother
    if(message.peerId instanceof Api.PeerUser){
        const targetPeerId = (message.peerId as Api.PeerUser).userId.toString();
        const myUserId = userBot.currentUser.id.toString();
        return {
            isValid: targetPeerId === myUserId,
            source: 'user'
        };
    }

    if(message.peerId instanceof Api.PeerChat){
        const targetPeerId = (message.peerId as Api.PeerChat).chatId.toString();
        return {
            isValid: Environment.get().options.FORWARD_CHANNELS.includes(targetPeerId),
            source: 'channel'
        }
    }

    return {
        isValid: false,
        source: undefined
    };
}