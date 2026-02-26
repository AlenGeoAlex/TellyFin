import {UserBot} from "@/userbot.js";
import {Environment} from "@/types/env.type.js";
import {Logger} from "@/logger.js";

export class JellyfinManager {

    private readonly jellyfinUrl : string | undefined;
    private readonly jellyfinApiKey : string | undefined;

    constructor(private readonly userBot: UserBot) {
        this.jellyfinUrl = Environment.get().options.JELLYFIN_URL;
        this.jellyfinApiKey = Environment.get().options.JELLYFIN_API_KEY;
    }

    public async tryRefresh() : Promise<boolean> {
        if(!this.jellyfinUrl || !this.jellyfinApiKey)
            return false;

        const refreshUrl = new URL("/Library/Refresh", this.jellyfinUrl);
        const response = await fetch(refreshUrl, {
            method: 'POST',
            headers: {
                'Authorization': `MediaBrowser Client="Telly-fin", Token="${this.jellyfinApiKey}"`,
            }
        })

        if(response.ok)
        {
            Logger.info("Refreshed Jellyfin library")
            return true;
        }

        Logger.error("Failed to refresh Jellyfin library. Status code: " + response.status + "")
        const errorResponse = await response.text();
        Logger.error(errorResponse)
        return false;
    }
}