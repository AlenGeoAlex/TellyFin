import {configDotenv} from "dotenv";

export class Environment {

    private readonly _options : Options;
    private static _instance : Environment | undefined;

    private constructor() {
        configDotenv()
        this._options = {
            RUN_AS: (process.env.RUN_AS as 'LOGIN' | 'BOT') ?? 'BOT',
            API_ID: process.env.API_ID!,
            API_HASH: process.env.API_HASH!,
            SESSION_STRING: process.env.SESSION_STRING!,
            FORWARD_CHANNELS: process.env.FORWARD_CHANNELS?.split(',')
                .map(x => x.trim())?? [],
            LLM_MODEL_PATH: process.env.LLM_MODEL_PATH!,
            TMDB_API_KEY: process.env.TMDB_API_KEY!,
            DOWNLOAD_CONCURRENCY: parseInt(process.env.DOWNLOAD_CONCURRENCY ?? '1') || 1,
            MAX_CONCURRENT_DOWNLOADS: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS ?? '10') || 10,
            LANGUAGE_JSON_PATH: process.env.LANGUAGE_JSON_PATH || './language.json',
            MEDIA_ROOT: process.env.MEDIA_ROOT || '/media',
            MOVIE_PATH: (process.env.MOVIE_PATH) ?? './movies',
            SERIES_PATH: (process.env.SERIES_PATH) ?? './series',
            JELLYFIN_URL: process.env.JELLYFIN_URL,
            JELLYFIN_API_KEY: process.env.JELLYFIN_API_KEY,
        };
    }

    public get options() : Options {
        return this._options;
    }

    public static get(){
        if(!Environment._instance) Environment._instance = new Environment();

        return Environment._instance;
    }

}


//https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
interface Options {
    RUN_AS : 'LOGIN' | 'BOT'
    API_ID : string;
    API_HASH : string;
    SESSION_STRING: string;
    FORWARD_CHANNELS: string[];
    TMDB_API_KEY: string;
    LLM_MODEL_PATH: string;
    DOWNLOAD_CONCURRENCY: number;
    MAX_CONCURRENT_DOWNLOADS: number;
    LANGUAGE_JSON_PATH: string;
    MEDIA_ROOT: string;
    SERIES_PATH: string;
    MOVIE_PATH: string;
    JELLYFIN_URL: string | undefined;
    JELLYFIN_API_KEY: string | undefined;
    [key: string]: string | string[] | number | undefined;
}