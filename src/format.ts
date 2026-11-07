import type { TimeSource } from "./settings.js";

/** Rendered when a value cannot be known -- never substitute a plausible-looking one. */
export const NO_TIME = "--:--";

/**
 * Format as HH:MM, 24-hour, zero padded.
 * Every source but "pc" is a UTC reading. "sim" is the simulator's own UTC, which
 * diverges from real UTC as soon as a departure time is set or time is compressed.
 */
export function formatHHMM(date: Date | null, source: TimeSource): string {
    if (date === null) return NO_TIME;
    const useUtc = source !== "pc";
    const h = useUtc ? date.getUTCHours() : date.getHours();
    const m = useUtc ? date.getUTCMinutes() : date.getMinutes();
    return `${pad(h)}:${pad(m)}`;
}

/** Chronometer readout as MM:SS, rolling over to HH:MM once past an hour. */
export function formatChrono(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    if (hours > 0) return `${pad(hours)}:${pad(Math.floor((total % 3600) / 60))}`;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * Time remaining until a target, counting down; once past it, the delay counting up
 * with a leading "+" -- the dispatch convention, and more useful than a countdown that
 * parks at zero.
 */
export function formatCountdown(
    target: Date | null,
    now: Date | null,
): { text: string; late: boolean } {
    if (target === null || now === null) return { text: NO_TIME, late: false };

    const remainingMs = target.getTime() - now.getTime();
    if (remainingMs >= 0) return { text: formatChrono(remainingMs), late: false };
    return { text: `+${formatChrono(-remainingMs)}`, late: true };
}

/**
 * Sim rate for the SIM clock's caption: "4X", "0.5X", or "" at normal speed.
 *
 * The bridge derives the rate from successive sim clock readings and smooths it, so it
 * wobbles around the setting rather than landing on it. MSFS rates are powers of two, so
 * the reading is snapped to the nearest one; anything that snaps to 1x shows nothing.
 */
export function simRateLabel(rate: number | null): string {
    if (rate === null || !Number.isFinite(rate) || rate <= 0) return "";
    const exponent = Math.min(7, Math.max(-2, Math.round(Math.log2(rate))));
    return exponent === 0 ? "" : `${2 ** exponent}X`;
}

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}
