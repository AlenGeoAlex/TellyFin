import {Api} from "telegram";
import {UserBot} from "@/userbot.js";
import {Logger} from "@/logger.js";
import {HostProgress} from "@/host/host.js";

const MAX_QUEUED_SHOWN = 10;

/**
 * Handles bot commands. Returns true when the message was a command.
 */
export async function handleCommand(message: Api.Message, userBot: UserBot): Promise<boolean> {
    const command = message.text?.trim().split(/\s+/)[0]?.toLowerCase();

    switch (command) {
        case '/status':
            await userBot.interactionHandler.replyToMessage(message.chatId, message.id, await buildStatus(userBot), true);
            return true;
        default:
            return false;
    }
}

async function buildStatus(userBot: UserBot): Promise<string> {
    const lines: string[] = ['📊 TellyFin status', ''];

    const dlc = await userBot.dlcDownloader.status().catch(err => {
        Logger.error(`Failed to get DLC status: ${err}`);
        return undefined;
    });

    lines.push('DLC downloads');
    if (!dlc) {
        lines.push('Failed to read status');
    } else {
        if (dlc.active) {
            const { active } = dlc;
            lines.push(`▶️ ${active.title ? `${active.title} ` : ''}[${active.name}]`);
            if (active.mirror && active.host) {
                const via = active.host.name === active.mirror.host ? '' : ` via ${active.host.name}`;
                lines.push(`   ${active.mirror.host}${via}, mirror ${active.attempt}/${active.attempts}`);
                lines.push(`   ${formatProgress(dlc.progress, active.attemptStartedAt)}`);
            } else {
                lines.push('   Identifying media...');
            }
        } else {
            lines.push('Idle');
        }

        lines.push(...formatQueued(dlc.queued));
        if (dlc.pendingDlcs > 0) lines.push(`DLC files waiting for JDownloader: ${dlc.pendingDlcs}`);
    }

    lines.push('', 'Telegram downloads');
    const telegram = userBot.telegramDownloader;
    const active = telegram.active;
    if (active) {
        lines.push(`▶️ ${active.title ? `${active.title} ` : ''}[${active.fileName}]`);
        const elapsed = (Date.now() - active.startedAt) / 1000;
        lines.push(active.total > 0
            ? `   ${formatProgress({
                loaded: active.downloaded,
                total: active.total,
                speed: elapsed > 0 ? active.downloaded / elapsed : undefined
            }, active.startedAt)}`
            : '   Identifying media...');
    } else {
        lines.push('Idle');
    }
    lines.push(...formatQueued(telegram.queued));

    return lines.join('\n');
}

function formatQueued(queued: string[]): string[] {
    if (queued.length === 0) return [];

    const lines = [`Queued (${queued.length}):`, ...queued.slice(0, MAX_QUEUED_SHOWN).map(name => `- ${name}`)];
    if (queued.length > MAX_QUEUED_SHOWN) lines.push(`…and ${queued.length - MAX_QUEUED_SHOWN} more`);
    return lines;
}

function formatProgress(progress: HostProgress | undefined, startedAt: number): string {
    const elapsed = formatDuration(Date.now() - startedAt);
    if (!progress) return `Starting... (${elapsed})`;

    const parts = [progress.total
        ? `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)} (${Math.min(100, Math.floor(progress.loaded / progress.total * 100))}%)`
        : formatBytes(progress.loaded)];

    if (progress.speed) parts.push(`${formatBytes(progress.speed)}/s`);
    parts.push(elapsed);
    return parts.join(' · ');
}

function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}
