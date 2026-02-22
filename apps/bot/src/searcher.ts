import {UserBot} from "@/userbot.js";
import {Logger} from "@/logger.js";

export class Searcher {

    constructor(
        private readonly userBot: UserBot
    ) {
    }

    public async search(query: string, messageId: number, chatId: any) {
        Logger.info(`Searching for: ${query}`);
        try {
            // TODO
            // const [movies, series] = await Promise.all([
            //     this.userBot.tmdbClient.searchMovies(query),
            //     this.userBot.tmdbClient.searchSeries(query)
            // ]);
            //
            // const results = [
            //     ...movies.map(m => ({ type: 'movie' as const, id: m.id, title: m.title, year: m.year })),
            //     ...series.map(s => ({ type: 'series' as const, id: s.id, title: s.name, year: s.firstAirYear }))
            // ].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 10);
            //
            // if (results.length === 0) {
            //     await this.userBot.interactionHandler.replyToMessage(chatId, messageId, "No results found on TMDB.");
            //     return;
            // }
            //
            // let responseText = "Search results:\n\n";
            // results.forEach((res, index) => {
            //     const yearStr = res.year ? ` (${res.year})` : "";
            //     const typeStr = res.type === 'movie' ? "🎬 Movie" : "📺 Series";
            //     responseText += `${index + 1}. ${typeStr}: **${res.title}**${yearStr}\n`;
            // });
            //
            // responseText += "\nReply with the number to search for the file.";
            //
            // await this.userBot.interactionHandler.replyToMessage(chatId, messageId, responseText);
        } catch (e) {
            Logger.error(`Search failed: ${e}`);
            await this.userBot.interactionHandler.replyToMessage(chatId, messageId, "An error occurred while searching.");
        }
    }

}