import {IHost} from "@/host/host.js";
import {PixelDrainHost} from "@/host/pixel-drain.host.js";
import {FileKeeperHost} from "@/host/file-keeper.host.js";
import {JDownloaderHost} from "@/host/jdownloader.host.js";
import {JDownloader} from "@/jdownloader.js";
import {Environment} from "@/types/env.type.js";
import {Mirror} from "@/types/download-task.js";

export interface PlannedMirror {
    mirror: Mirror;
    host: IHost;
}

export class HostRegistry {
    private readonly nativeHosts: IHost[];
    private readonly fallbackHost: IHost | undefined;
    private readonly priority: string[];

    constructor(jDownloader: JDownloader) {
        const options = Environment.get().options;

        this.nativeHosts = [new PixelDrainHost(), new FileKeeperHost()];
        this.fallbackHost = options.JDOWNLOADER_OUTPUT_PATH
            ? new JDownloaderHost(jDownloader, options.JDOWNLOADER_OUTPUT_PATH, options.JDOWNLOADER_CONTAINER_OUTPUT_PATH)
            : undefined;
        this.priority = options.HOST_PRIORITY;
    }

    /**
     * Orders mirrors by HOST_PRIORITY (unlisted hosts go last) and pairs each with the host that will download it.
     * Native hosts are preferred, JDownloader handles everything else. Mirrors nobody can handle are dropped.
     */
    public plan(mirrors: Mirror[]): PlannedMirror[] {
        const rank = (host: string) => {
            const index = this.priority.indexOf(host);
            return index === -1 ? this.priority.length : index;
        };

        return [...mirrors]
            .sort((a, b) => rank(a.host) - rank(b.host))
            .map(mirror => ({ mirror, host: this.resolve(mirror.host) }))
            .filter((planned): planned is PlannedMirror => planned.host !== undefined);
    }

    private resolve(host: string): IHost | undefined {
        return this.nativeHosts.find(native => native.canHandle(host))
            ?? (this.fallbackHost?.canHandle(host) ? this.fallbackHost : undefined);
    }
}
