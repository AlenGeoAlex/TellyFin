import {UserBot} from "@/userbot.js";
import {Logger} from "@/logger.js";

export class ConnectionHeartbeat {

    private lastTimestamp: number = Date.now();
    private readonly userbot: UserBot;

    constructor(userbot: UserBot) {
        this.userbot = userbot;
        setInterval(() => {
            this.tick()
                .catch(e => Logger.error("Failed to tick heartbeat: " + e))
        }, 1000 * 6);
        Logger.info("Connection heartbeat started")
    }

    private async tick(){
        if(!this.userbot.isSetupComplete)
            return;

        const telegramClient = this.userbot.telegramClient;
        if(!telegramClient)
            return;

        if(telegramClient.connected)
        {
            Logger.info("Connection is still alive, skipping heartbeat")
            return;
        }

        const lastConnected = Date.now() - this.lastTimestamp;
        Logger.info("Connection is dead, reconnecting, last connection is: " + lastConnected + "ms ago")
        this.lastTimestamp = Date.now();
        await telegramClient.connect();
        Logger.info("Reconnected")
        try {
            // telegramClient.sendMessage()
        }catch (e){
            Logger.error("Failed to reconnect: " + e)
        }
    }

}