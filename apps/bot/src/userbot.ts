import {Environment} from "@/types/env.type.js";
import {Api, TelegramClient} from "telegram";
import {createClient} from "@/client.js";
import {Logger} from "@/logger.js";
import {NewMessage, NewMessageEvent, Raw} from "telegram/events/index.js";
import {Searcher} from "@/searcher.js";
import {Downloader} from "@/downloader.js";
import {LlamaModelManager} from "@/llm-model-manager.js";
import {TMDBClient} from "@/tmdb-client.js";
import {InteractionHandler} from "@/interaction-handler.js";
import {messageHandler} from "@/handlers/message-handler.js";
import {ReplyHandler} from "@/handlers/reply-handler.js";
import Message = Api.Message;
import {ConnectionHeartbeat} from "@/connection-heartbeat.js";
import {JellyfinManager} from "@/jellyfin/jellyfin-manager.js";

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
    private readonly _downloader: Downloader;
    private readonly _llmModelManager: LlamaModelManager;
    private readonly _tmdbClient: TMDBClient;
    private readonly _interactionHandler: InteractionHandler;
    private readonly _replyHandler: ReplyHandler;
    private readonly _jellyfinManager: JellyfinManager;
    constructor(
        private readonly client: TelegramClient
    ) {
        this._searcher = new Searcher(this);
        this._downloader = new Downloader(this);
        this._llmModelManager = new LlamaModelManager(Environment.get().options.LLM_MODEL_PATH)
        this._tmdbClient = new TMDBClient(
            Environment.get().options.TMDB_API_KEY,
            Environment.get().options.LANGUAGE_JSON_PATH
        );
        this._interactionHandler = new InteractionHandler(this);
        this._replyHandler = new ReplyHandler(this);
        this._jellyfinManager = new JellyfinManager(this);
    }

    async setupClient(){
        if(this._isSetupComplete) return;
        this.me = await this.client.getMe();
        Logger.log(`Logged in as ${this.me.username}`)
        this.client.addEventHandler(async (event: NewMessageEvent) => {
            if(event.message.replyTo){
                Logger.info("Reply message detected - Forwarding to reply handler")
                await this._replyHandler.handleReply(event.message);
            }else{
                Logger.info("Message detected - Forwarding to message handler")
                await messageHandler(event, {userBot: this});
            }
        }, new NewMessage({}))

        this.client.addEventHandler(async (update: Api.TypeUpdate) => {
            if(update.className === 'UpdateEditMessage'){
                if (update.message.className === 'Message') {
                    const message = update.message as Message;
                    message.reactions?.recentReactions?.forEach(reaction => {
                        if (reaction.reaction instanceof Api.ReactionEmoji) {
                            const emoticon = reaction.reaction.emoticon;
                            const peerId = reaction.peerId;

                            console.log(emoticon);
                        }
                    })
                }
            }
        }, new Raw({}));
        this._isSetupComplete = true;
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

    get downloader(): Downloader {
        return this._downloader;
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

    async gracefulShutdown(signal: string) {
        Logger.info(`Received ${signal}, shutting down gracefully...`);

        try {
            await this.downloader.pauseQueue();
            Logger.info(`Waiting for ${this.downloader.pending} pending downloads to finish...`);

            await Promise.race([
                this.downloader.queueOnIdle(),
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