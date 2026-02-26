// persistent-queue.ts
import PQueue from "p-queue";
import * as fs from "node:fs";
import {Logger} from "@/logger.js";

interface PersistedEntry<T> {
    id: string;
    data: T;
    order: number;
}

export class PersistentQueue<T> {
    private readonly queue: PQueue;
    private readonly pending: Map<string, PersistedEntry<T>> = new Map();
    private sequence: number = 0;

    constructor(
        private readonly handler: (task: T) => Promise<void>,
        private readonly opts: { concurrency: number; dbPath: string }
    ) {
        this.queue = new PQueue({ concurrency: opts.concurrency });
        this.restore();
    }

    private persist(): void {
        const entries = [...this.pending.values()];
        fs.writeFileSync(this.opts.dbPath, JSON.stringify(entries, null, 2));
    }

    private restore(): void {
        if (!fs.existsSync(this.opts.dbPath)) return;

        try {
            const raw = fs.readFileSync(this.opts.dbPath, 'utf-8');
            const entries: PersistedEntry<T>[] = JSON.parse(raw);

            entries.sort((a, b) => a.order - b.order);
            this.sequence = entries.length > 0 ? entries[entries.length - 1].order + 1 : 0;

            Logger.info(`Restoring ${entries.length} pending tasks from ${this.opts.dbPath}`);
            for (const entry of entries) {
                this.enqueue(entry);
            }
        } catch (err) {
            Logger.error(`Failed to restore queue from ${this.opts.dbPath}: ${err}`);
        }
    }

    public push(id: string, data: T): void {
        if (this.pending.has(id)) {
            Logger.warn(`Task ${id} is already queued, skipping.`);
            return;
        }

        const entry: PersistedEntry<T> = { id, data, order: this.sequence++ };
        this.pending.set(id, entry);
        this.persist();
        this.enqueue(entry);
    }

    private enqueue(entry: PersistedEntry<T>): void {
        this.queue.add(async () => {
            try {
                await this.handler(entry.data);
            } finally {
                this.pending.delete(entry.id);
                this.persist();
            }
        }, { priority: -entry.order });
    }

    public get size(): number {
        return this.queue.size + this.queue.pending;
    }

    public pause(): void {
        this.queue.pause();
    }

    public async onIdle(): Promise<void> {
        return this.queue.onIdle();
    }
}