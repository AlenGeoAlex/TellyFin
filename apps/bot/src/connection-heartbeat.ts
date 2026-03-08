import {UserBot} from "@/userbot.js";
import {Logger} from "@/logger.js";
import {Api} from "telegram";
import bigInt from "big-integer";

export class ConnectionHeartbeat {

    private lastTimestamp: number = Date.now();
    private readonly userbot: UserBot;

    constructor(userbot: UserBot) {
        this.userbot = userbot;
        setInterval(() => {
            this.tick()
                .catch(e => Logger.error("Failed to tick heartbeat: " + e))
        }, 1000 * 60);
        Logger.info("Connection heartbeat started")
    }

    private async tick(){
        if(!this.userbot.isSetupComplete)
            return;

        const telegramClient = this.userbot.telegramClient;
        if(!telegramClient)
            return;

        try {
            await telegramClient.invoke(new Api.Ping({ pingId: bigInt(Date.now()) }));
            Logger.info("Heartbeat ping OK");
        } catch (e) {
            const lastConnected = Date.now() - this.lastTimestamp;
            Logger.warn(`Heartbeat ping failed, reconnecting... last alive: ${lastConnected}ms ago`);
            this.lastTimestamp = Date.now();
            try {
                await telegramClient.connect();
                Logger.info("Reconnected");
            } catch (reconnectErr) {
                Logger.error("Failed to reconnect: " + reconnectErr);
                process.exit(1);
            }
        }
    }

}