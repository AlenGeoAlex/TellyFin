import {UserBot} from "@/userbot.js";
import {Api, TelegramClient} from "telegram";
import {Emoticon} from "@/constants/emoticon.js";
import {Logger} from "@/logger.js";

export class InteractionHandler {

    constructor(
        private readonly userBot: UserBot
    ) {
    }

    private get client() : TelegramClient{
        return this.userBot.telegramClient;
    }

    public async react(
        chatId: bigInt.BigInteger | undefined,
        messageId: number,
        emote: Emoticon
    ) : Promise<boolean>{
        try {
            const response = await this.client.invoke(new Api.messages.SendReaction({
                peer: chatId,
                msgId: messageId,
                reaction: [
                    new Api.ReactionEmoji({
                        emoticon: emote
                    })
                ]
            }));

            return true;
        }catch (e){
            Logger.error(`Failed to react to message: ${JSON.stringify(e)}`)
            return false;
        }
    }

    public async replyToMessage(
        chatId: number,
        messageId: number,
        message: string
    ) {
        try {
            const response = await this.client.sendMessage(chatId, {
                message,
                replyTo: messageId
            })

            return response.id;
        }catch (e)
        {
            Logger.error(`Failed to reply to message: ${JSON.stringify(e)}`)
            return undefined;
        }
    }

}