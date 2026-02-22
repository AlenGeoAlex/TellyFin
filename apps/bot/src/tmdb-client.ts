import * as fs from "fs";
import {Logger} from "@/logger.js";

export interface TMDBMovie {
    id: number;
    title: string;
    originalTitle: string;
    year: number | null;
    overview: string;
    posterPath: string | null;
    popularity: number;
    originalLanguage: string;
    originCountry: string[];
}

export interface TMDBSeries {
    id: number;
    name: string;
    originalName: string;
    firstAirYear: number | null;
    overview: string;
    posterPath: string | null;
    popularity: number;
    originalLanguage: string;
    originCountry: string[];
}

export interface TMDBEpisode {
    id: number;
    name: string;
    overview: string;
    seasonNumber: number;
    episodeNumber: number;
    airDate: string | null;
    stillPath: string | null;
}

export interface ResolvedMedia {
    type: "movie" | "series";
    tmdbId: number;
    title: string;
    originalTitle: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    episodeName: string | null;
    posterPath: string | null;
    suggestedFilename: string;
    extension: string;
    originalLanguage: string;       // ISO 639-1 code e.g. "ml"
    languageName: string;           // Full name e.g. "Malayalam"
    originCountry: string[];        // e.g. ["IN"]
}

export class TMDBClient {
    private apiKey: string;
    private baseUrl = "https://api.themoviedb.org/3";
    private languages: Record<string, string>;

    constructor(apiKey?: string, languagesPath?: string) {
        this.apiKey = apiKey || process.env.TMDB_API_KEY || "";
        if (!this.apiKey) {
            throw new Error("TMDB_API_KEY is required. Get one free at https://www.themoviedb.org/settings/api");
        }

        const resolvedPath = languagesPath;
        Logger.log(`Try Loading language names from ${resolvedPath}`);
        if (resolvedPath && fs.existsSync(resolvedPath)) {
            this.languages = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
            Logger.log(`Loaded language names from ${resolvedPath}`);
        } else {
            this.languages = {
                ml: "Malayalam", ko: "Korean",  hi: "Hindi",
                ta: "Tamil",     te: "Telugu",  kn: "Kannada",
                mr: "Marathi",   bn: "Bengali", en: "English",
                ja: "Japanese",  zh: "Chinese", fr: "French",
                es: "Spanish",   de: "German",  it: "Italian",
                pt: "Portuguese",ru: "Russian", ar: "Arabic",
                tr: "Turkish",   th: "Thai",
            };
            Logger.log(`Loaded fallback language names`);
        }
    }


    private getLanguageName(code: string): string {
        return this.languages[code] ?? code;
    }


    private async get<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
        const url = new URL(`${this.baseUrl}${endpoint}`);
        url.searchParams.set("api_key", this.apiKey);
        for (const [k, v] of Object.entries(params)) {
            url.searchParams.set(k, v);
        }

        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
        }

        const response = await res.json();
        Logger.log(`TMDB API request successful: ${endpoint} with data ${JSON.stringify(response)}`);
        return response;
    }

    public async searchMovies(query: string, year?: number | null): Promise<TMDBMovie[]> {
        const params: Record<string, string> = { query };
        if (year) params["year"] = String(year);
        Logger.log(`Searching TMDB for movies with query ${query} and year ${year}`);
        let data = await this.get<{ results: any[] }>("/search/movie", params);

        return data.results.map((r) => ({
            id: r.id,
            title: r.title,
            originalTitle: r.original_title,
            year: r.release_date ? parseInt(r.release_date.split("-")[0]) : null,
            overview: r.overview,
            posterPath: r.poster_path,
            popularity: r.popularity,
            originalLanguage: r.original_language ?? "en",
            originCountry: (r.origin_country ?? []) as string[],
        }));
    }


    public async searchSeries(query: string, year?: number | null): Promise<TMDBSeries[]> {
        const params: Record<string, string> = { query };
        if (year) params["first_air_date_year"] = String(year);
        Logger.log(`Searching TMDB for series with query ${query} and year ${year}`);
        const data = await this.get<{ results: any[] }>("/search/tv", params);

        return data.results.map((r) => ({
            id: r.id,
            name: r.name,
            originalName: r.original_name,
            firstAirYear: r.first_air_date ? parseInt(r.first_air_date.split("-")[0]) : null,
            overview: r.overview,
            posterPath: r.poster_path,
            popularity: r.popularity,
            originalLanguage: r.original_language ?? "en",
            originCountry: (r.origin_country ?? []) as string[],
        }));
    }


    private async getEpisode(
        seriesId: number,
        season: number,
        episode: number
    ): Promise<TMDBEpisode | null> {
        try {
            Logger.log(`Fetching episode ${episode} of season ${season} of series ${seriesId}`);
            const data = await this.get<any>(
                `/tv/${seriesId}/season/${season}/episode/${episode}`
            );

            return {
                id: data.id,
                name: data.name,
                overview: data.overview,
                seasonNumber: data.season_number,
                episodeNumber: data.episode_number,
                airDate: data.air_date,
                stillPath: data.still_path,
            };
        } catch {
            return null;
        }
    }


    private _yearMatches(foundYear: number | null, candidateYear: number | null | undefined): boolean {
        if (!foundYear || !candidateYear) return true;
        return Math.abs(foundYear - candidateYear) <= 1;
    }


    private async _resolveMovie(
        candidateTitle: string,
        year: number | null | undefined,
        ext: string
    ): Promise<ResolvedMedia | null> {
        const results = await this.searchMovies(candidateTitle, year);
        if (results.length === 0) return null;

        const best = results[0];
        const yearStr = best.year ? ` (${best.year})` : "";

        return {
            type: "movie",
            tmdbId: best.id,
            title: best.title,
            originalTitle: best.originalTitle,
            year: best.year,
            season: null,
            episode: null,
            episodeName: null,
            posterPath: best.posterPath,
            suggestedFilename: `${best.title}${yearStr}.${ext}`,
            extension: ext,
            originalLanguage: best.originalLanguage,
            languageName: this.getLanguageName(best.originalLanguage),
            originCountry: best.originCountry,
        };
    }


    private async _resolveSeries(
        candidateTitle: string,
        year: number | null | undefined,
        season: number | null | undefined,
        episode: number | null | undefined,
        ext: string
    ): Promise<ResolvedMedia | null> {
        const results = await this.searchSeries(candidateTitle, year);
        if (results.length === 0) return null;

        const best = results[0];
        const s = season ?? null;
        const e = episode ?? null;

        let episodeName: string | null = null;
        if (s !== null && e !== null) {
            const ep = await this.getEpisode(best.id, s, e);
            episodeName = ep?.name || null;
        }

        const seasonEp = s !== null && e !== null
            ? `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`
            : "";

        return {
            type: "series",
            tmdbId: best.id,
            title: best.name,
            originalTitle: best.originalName,
            year: best.firstAirYear,
            season: s,
            episode: e,
            episodeName,
            posterPath: best.posterPath,
            suggestedFilename: seasonEp
                ? `${best.name} ${seasonEp}.${ext}`
                : `${best.name}.${ext}`,
            extension: ext,
            originalLanguage: best.originalLanguage,
            languageName: this.getLanguageName(best.originalLanguage),
            originCountry: best.originCountry,
        };
    }


    async resolve(
        candidateTitle: string,
        options: {
            isMovie: boolean;
            year?: number | null;
            season?: number | null;
            episode?: number | null;
            fileExtension?: string;
        }
    ): Promise<ResolvedMedia | null> {
        const ext = options.fileExtension || "mkv";

        // Run both searches in parallel
        const [movieResult, seriesResult] = await Promise.all([
            this._resolveMovie(candidateTitle, options.year, ext),
            this._resolveSeries(candidateTitle, options.year, options.season, options.episode, ext),
        ]);

        if (options.isMovie) {
            if (movieResult) return movieResult;
            if (seriesResult && this._yearMatches(seriesResult.year, options.year)) return seriesResult;
            return seriesResult ?? null;
        } else {
            if (seriesResult) return seriesResult;
            if (movieResult && this._yearMatches(movieResult.year, options.year)) return movieResult;
            return movieResult ?? null;
        }
    }
}