import {Environment} from "@/types/env.type.js";
import {Api, TelegramClient} from "telegram";
import {createClient} from "@/client.js";
import {Logger} from "@/logger.js";
import {NewMessage, NewMessageEvent, Raw} from "telegram/events/index.js";
import {Searcher} from "@/searcher.js";
import {TelegramDownloader} from "@/telegram-downloader.js";
import {LlamaModelManager} from "@/llm-model-manager.js";
import {TMDBClient} from "@/tmdb-client.js";
import {InteractionHandler} from "@/interaction-handler.js";
import {messageHandler} from "@/handlers/message-handler.js";
import {ReplyHandler} from "@/handlers/reply-handler.js";
import Message = Api.Message;
import {ConnectionHeartbeat} from "@/connection-heartbeat.js";
import {JellyfinManager} from "@/jellyfin/jellyfin-manager.js";
import {DLCDownloader} from "@/dlc-downloader.js";
import {JDownloader} from "@/jdownloader.js";

export async function start() {
    const client = createClient(true);

    Logger.log('Connecting to Telegram...')
    try {
        const connected = await client.connect();
        if(!connected) throw new Error('Failed to connect to Telegram');
    } catch (e) {
        throw e;
    }
    Logger.log('Connected to Telegram')
    const userBot = new UserBot(client);
    const heartbeat = new ConnectionHeartbeat(userBot);
    process.on("SIGTERM", () => userBot.gracefulShutdown("SIGTERM"));
    process.on("SIGINT",  () => userBot.gracefulShutdown("SIGINT"));
    process.on("uncaughtException", (err) => {
        if (err.message === "TIMEOUT") {
            Logger.warn("GramJS update loop timeout — reconnecting...");
            if(client.disconnected)
                client.connect().catch(() => {});
            return;
        }
        Logger.error(`Uncaught exception: ${err}`);
        process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
        if (reason instanceof Error && reason.message === "TIMEOUT") {
            Logger.warn("GramJS timeout rejection — reconnecting...");
            if(client.disconnected)
                client.connect().catch(() => {});
            return;
        }
        Logger.error(`Unhandled rejection: ${reason}`);
    });
    await userBot.setupClient();
}

export class UserBot {

    private _isSetupComplete = false;
    private me!: Api.User;
    private readonly _searcher: Searcher;
    private readonly _telegramDownloader: TelegramDownloader;
    private readonly _dlcDownloader: DLCDownloader;
    private readonly _llmModelManager: LlamaModelManager;
    private readonly _tmdbClient: TMDBClient;
    private readonly _interactionHandler: InteractionHandler;
    private readonly _replyHandler: ReplyHandler;
    private readonly _jellyfinManager: JellyfinManager;
    private readonly _jDownloader: JDownloader;
    private _newMessageHandler?: (event: NewMessageEvent) => Promise<void>;
    private _rawUpdateHandler?: (update: Api.TypeUpdate) => Promise<void>;


    constructor(
        private readonly client: TelegramClient
    ) {
        this._searcher = new Searcher(this);
        this._telegramDownloader = new TelegramDownloader(this);
        this._llmModelManager = new LlamaModelManager(Environment.get().options.LLM_MODEL_PATH)
        this._tmdbClient = new TMDBClient(
            Environment.get().options.TMDB_API_KEY,
            Environment.get().options.LANGUAGE_JSON_PATH
        );
        this._interactionHandler = new InteractionHandler(this);
        this._replyHandler = new ReplyHandler(this);
        this._jellyfinManager = new JellyfinManager(this);
        this._dlcDownloader = new DLCDownloader(this);
        this._jDownloader = new JDownloader(Environment.get().options.JDOWNLOADER_URL!);
    }

    async setupClient(){
        if(this._isSetupComplete) return;
        this.me = await this.client.getMe();
        Logger.log(`Logged in as ${this.me.username}`);

        this.registerEventHandlers();

        await this.jDownloader.clearList();
        this._isSetupComplete = true;
    }

    public registerEventHandlers(){
        if(this._newMessageHandler)
            this.client.removeEventHandler(this._newMessageHandler, new NewMessage({}));
        if(this._rawUpdateHandler)
            this.client.removeEventHandler(this._rawUpdateHandler, new Raw({}));

        this._newMessageHandler = async (event: NewMessageEvent) => {
            console.log("New message event received");
            if(event.message.replyTo){
                Logger.info("Reply message detected - Forwarding to reply handler");
                await this._replyHandler.handleReply(event.message);
            } else {
                Logger.info("Message detected - Forwarding to message handler");
                await messageHandler(event, {userBot: this});
            }
        };

        this._rawUpdateHandler = async (update: Api.TypeUpdate) => {
            if(update.className === 'UpdateEditMessage'){
                if(update.message.className === 'Message'){
                    const message = update.message as Message;
                    message.reactions?.recentReactions?.forEach(reaction => {
                        if(reaction.reaction instanceof Api.ReactionEmoji){
                            console.log(reaction.reaction.emoticon);
                        }
                    });
                }
            }
        };

        this.client.addEventHandler(this._newMessageHandler, new NewMessage({}));
        this.client.addEventHandler(this._rawUpdateHandler, new Raw({}));
    }


    public get dlcDownloader(): DLCDownloader {
        return this._dlcDownloader;
    }

    public get telegramClient() : TelegramClient {
        return this.client;
    }

    public get environment(): Environment {
        return Environment.get();
    }

    public get currentUser() : Api.User {
        return this.me;
    }

    get searcher(): Searcher {
        return this._searcher;
    }

    get telegramDownloader(): TelegramDownloader {
        return this._telegramDownloader;
    }

    get llmModelManager(): LlamaModelManager {
        return this._llmModelManager;
    }


    get tmdbClient(): TMDBClient {
        return this._tmdbClient;
    }

    get interactionHandler(): InteractionHandler {
        return this._interactionHandler;
    }

    get isSetupComplete(): boolean {
        return this._isSetupComplete;
    }

    get jellyfinManager(): JellyfinManager {
        return this._jellyfinManager;
    }

    get jDownloader(): JDownloader {
        return this._jDownloader;
    }

    async gracefulShutdown(signal: string) {
        Logger.info(`Received ${signal}, shutting down gracefully...`);

        try {
            await this.telegramDownloader.pauseQueue();
            Logger.info(`Waiting for ${this.telegramDownloader.pending} pending downloads to finish...`);

            await Promise.race([
                this.telegramDownloader.queueOnIdle(),
                new Promise(r => setTimeout(r, 30_000)), // max 30s wait
            ]);

            await this.telegramClient.disconnect();
            Logger.info("Disconnected. Bye!");
        } catch (err) {
            Logger.error(`Error during shutdown: ${err}`);
        } finally {
            process.exit(0);
        }
    }
}