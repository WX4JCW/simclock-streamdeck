import type { JsonObject } from "@elgato/utils";

export type TimeSource = "pc" | "zulu" | "sim" | "std" | "tostd" | "eta" | "toeta";

export type ClockSettings = {
    source?: TimeSource;
    /** Top line. Blank means "use the default label for the chosen source". */
    header?: string;
    fontFamily?: string;
    headerColor?: string;
    timeColor?: string;
    bgColor?: string;
    bgTransparent?: boolean;
    /** "panel" (default) or "classic", the look before Panel with the colours above. */
    style?: string;
    /** Clocks a dial switches between when turned; two or more replace `source`. */
    cycle?: string[];
    /** Which of `cycle` is showing, kept so the dial comes back where it was left. */
    cycleIndex?: number;
} & JsonObject;

/** Plugin-wide settings, shared by every placed instance. */
export type GlobalSettings = {
    simbriefUsername?: string;
    /** Font families read from the registry, published for the Property Inspector. */
    installedFonts?: string[];
} & JsonObject;

export const DEFAULTS = {
    source: "pc" as TimeSource,
    fontFamily: "Segoe UI",
    headerColor: "#9AA0A6",
    timeColor: "#FFFFFF",
    bgColor: "#000000",
} as const;

/** Header shown when the user hasn't typed their own. */
const SOURCE_LABELS: Record<TimeSource, string> = {
    pc: "LOCAL",
    zulu: "ZULU",
    sim: "SIM",
    std: "STD",
    tostd: "TO STD",
    eta: "ETA",
    toeta: "TO ETA",
};

/** Replaces the TO STD label once scheduled off-block has passed. */
export const LATE_LABEL = "LATE";

/** Every source, in the order the panel lists them and a dial steps through them. */
const SOURCE_ORDER: TimeSource[] = ["pc", "zulu", "sim", "std", "tostd", "eta", "toeta"];
const VALID_SOURCES = new Set<string>(SOURCE_ORDER);

/**
 * The clocks a dial switches between, in panel order whatever order they were ticked in.
 * Fewer than two is no list at all: the dial shows `source` as it always did.
 */
export function cycleSources(settings: ClockSettings): TimeSource[] {
    const ticked = Array.isArray(settings.cycle) ? new Set(settings.cycle) : new Set();
    const list = SOURCE_ORDER.filter((s) => ticked.has(s));
    return list.length >= 2 ? list : [];
}

/** True when this instance switches between clocks rather than showing one. */
export function isCycling(settings: ClockSettings): boolean {
    return cycleSources(settings).length > 0;
}

/** Position in the list after turning `ticks` detents, wrapping at both ends. */
export function nextCycleIndex(settings: ClockSettings, ticks: number): number {
    const n = cycleSources(settings).length;
    if (n === 0) return 0;
    const at = cycleIndexOf(settings, n);
    return (((at + ticks) % n) + n) % n;
}

function cycleIndexOf(settings: ClockSettings, n: number): number {
    const i = settings.cycleIndex;
    return typeof i === "number" && Number.isInteger(i) ? ((i % n) + n) % n : 0;
}

/** The source showing now: the current pick from the list, or the single `source`. */
export function resolveSource(settings: ClockSettings): TimeSource {
    const list = cycleSources(settings);
    if (list.length > 0) return list[cycleIndexOf(settings, list.length)] ?? DEFAULTS.source;
    const s = settings.source;
    return typeof s === "string" && VALID_SOURCES.has(s) ? (s as TimeSource) : DEFAULTS.source;
}

/** The automatic header for a source, before any custom override. */
export function defaultHeader(source: TimeSource): string {
    return SOURCE_LABELS[source];
}

/**
 * A typed header always wins, including over a dynamic one such as LATE -- if the user
 * named the key themselves, we don't rename it out from under them.
 */
export function resolveHeader(settings: ClockSettings, fallback: string): string {
    // One typed name cannot fit several clocks, so a dial that switches uses the auto names.
    if (isCycling(settings)) return fallback;
    const custom = settings.header?.trim();
    return custom && custom.length > 0 ? custom : fallback;
}

export function resolveFont(settings: ClockSettings): string {
    const f = settings.fontFamily?.trim();
    return f && f.length > 0 ? f : DEFAULTS.fontFamily;
}

/** Accepts #rgb / #rrggbb only; anything else falls back so a typo can't produce invalid SVG. */
export function resolveColor(value: string | undefined, fallback: string): string {
    const v = value?.trim();
    return v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
}

/** Sources that read the simulator's clock, and so need the bridge running. */
export function needsSimBridge(source: TimeSource): boolean {
    return source === "sim" || source === "tostd" || source === "toeta";
}

/** Sources that read an OFP from SimBrief. */
export function needsSimBrief(source: TimeSource): boolean {
    return source === "std" || source === "tostd" || source === "eta" || source === "toeta";
}
