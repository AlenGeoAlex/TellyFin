import {Environment} from "@/types/env.type.js";
import { TelegramClient} from "telegram";
import {StringSession} from "telegram/sessions/index.js";
import {Logger} from "@/logger.js";

/**
 * Creates and returns a new instance of the TelegramClient.
 *
 * @param {boolean} [isSessionMandatory=false] - Determines whether a session string is required.
 * If true, the method retrieves the session string from environment variables.
 * @return {TelegramClient} A new configured instance of the TelegramClient.
 * @throws {Error} If `API_HASH` or `API_ID` is missing from the environment variables.
 * @throws {Error} If `API_ID` is not a valid number.
 * @throws {Error} If `isSessionMandatory` is true and `SESSION_STRING` is missing from the environment variables.
 */
export function createClient(
    isSessionMandatory: boolean = false
) : TelegramClient {
    const apiHash = Environment.get().options.API_HASH;
    const apiIdRaw = Environment.get().options.API_ID;

    if(!apiHash || !apiIdRaw) throw new Error(
        'API_HASH or API_ID not found in environment variables'
    )

    let apiId = 0;
    try {
        apiId = Number(apiIdRaw);
    }catch (e) {
        throw new Error('API_ID is not a number');
    }

    let sessionString = new StringSession("");

    if(isSessionMandatory){
        const sessionTokenRaw = Environment.get().options.SESSION_STRING;
        if(!sessionTokenRaw) throw new Error('SESSION_STRING not found in environment variables');
        sessionString = new StringSession(sessionTokenRaw);
    }

    const telegramClient = new TelegramClient(
        sessionString,
        Number(Environment.get().options.API_ID),
        Environment.get().options.API_HASH,
        {
            deviceModel: 'BOT_JELLYFIN',
            maxConcurrentDownloads: Environment.get().options.MAX_CONCURRENT_DOWNLOADS,
            requestRetries: 5,
            downloadRetries: 5,
            connectionRetries: 5,
            autoReconnect: true,
        }
    );

    telegramClient.onError = async (err) => {
        Logger.error(`Telegram client error: ${err.message}`);
    }

    return telegramClient;
}