import type { JsonObject } from "@elgato/utils";

export type TimeSource = "pc" | "zulu" | "sim" | "std" | "tostd";

export type ClockSettings = {
    source?: TimeSource;
    /** Top line. Blank means "use the default label for the chosen source". */
    header?: string;
    fontFamily?: string;
    headerColor?: string;
    timeColor?: string;
    bgColor?: string;
    bgTransparent?: boolean;
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
};

/** Replaces the TO STD label once scheduled off-block has passed. */
export const LATE_LABEL = "LATE";

const VALID_SOURCES = new Set<string>(["pc", "zulu", "sim", "std", "tostd"]);

export function resolveSource(settings: ClockSettings): TimeSource {
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
    return source === "sim" || source === "tostd";
}

/** Sources that read an OFP from SimBrief. */
export function needsSimBrief(source: TimeSource): boolean {
    return source === "std" || source === "tostd";
}
