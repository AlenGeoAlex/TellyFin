import {ResolvedMedia} from "@/tmdb-client.js";

export function cleanFileName(name: string) {
    return name
        .replace(/\*\*|__/g, "")        // bold/italic markdown
        .replace(/#\w+/g, "")           // hashtags like #Bollywood
        .replace(/\[.*?\]/g, "")        // anything in square brackets like [MS], [Malayalam 1080p]
        .replace(/@\S+\s*-?\s*/g, "")   // @TamilMV - style prefixes
        .replace(/www\.\S+\s*-?\s*/g, "") // www.site.com prefixes
        .replace(/\s{2,}/g, " ")        // collapse multiple spaces
        .trim();
}

export function resolvePath(template: string, media: ResolvedMedia): string {
    const season = media.season ?? 1;
    const episode = media.episode ?? 1;

    const placeholders: Record<string, string> = {
        TITLE:          sanitize(media.title),
        ORIGINAL_TITLE: sanitize(media.originalTitle),
        YEAR:           String(media.year ?? "Unknown"),
        LANGUAGE_NAME:  media.languageName ?? media.originalLanguage ?? "Unknown",
        LANGUAGE_CODE:  media.originalLanguage ?? "unknown",
        ORIGIN_COUNTRY: media.originCountry?.[0] ?? "Unknown",
        SEASON:         String(season),
        SEASON_PAD:     String(season).padStart(2, "0"),
        EPISODE:        String(episode),
        EPISODE_PAD:    String(episode).padStart(2, "0"),
        SEASON_EPISODE: `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
        EPISODE_NAME:   sanitize(media.episodeName ?? ""),
        EXT:            media.extension ?? "mkv",
    };

    return template.replace(/\{(\w+)\}/g, (_, key) => placeholders[key] ?? key);
}

function sanitize(str: string): string {
    return str.replace(/[<>:"/\\|?*]/g, "").trim();
}