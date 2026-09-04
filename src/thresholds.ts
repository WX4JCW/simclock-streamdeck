import { resolveColor, type ClockSettings } from "./settings.js";

/**
 * Recolours the countdown's time text as scheduled off-block approaches.
 *
 * Three user-defined minute/colour pairs plus the base colour. The rule that wins is the
 * smallest threshold the remaining time still falls under, so with 10/5/0 minutes set:
 * more than 10 minutes out uses the base colour, then 10, then 5, then 0 -- which also
 * covers every negative value, i.e. everything after departure.
 *
 * A threshold with no minutes entered is off, so one, two or three may be used.
 */
export type Threshold = { minutes: number; color: string };

/**
 * Each row carries its own default colour. This matters: an <sdpi-color> only writes its
 * setting once the user opens the picker, so someone who types the minutes and leaves the
 * swatch alone has no colour saved at all. Falling back to a neutral white there fires the
 * threshold but renders it invisible-looking -- the fallback has to be the colour the
 * panel is already showing them.
 */
const SLOTS = [
    { minutes: "warn1Min", color: "warn1Color", fallback: "#FFD400" },
    { minutes: "warn2Min", color: "warn2Color", fallback: "#FF8A00" },
    { minutes: "warn3Min", color: "warn3Color", fallback: "#FF3B30" },
] as const;

/** Configured thresholds, ascending, skipping any left blank or malformed. */
export function readThresholds(settings: ClockSettings): Threshold[] {
    const out: Threshold[] = [];
    for (const slot of SLOTS) {
        const raw = settings[slot.minutes];
        const minutes = parseMinutes(raw);
        if (minutes === null) continue;
        out.push({
            minutes,
            color: resolveColor(settings[slot.color] as string | undefined, slot.fallback),
        });
    }
    return out.sort((a, b) => a.minutes - b.minutes);
}

/**
 * Colour for a countdown with `remainingMs` left, or `baseColor` when no threshold
 * applies. Negative remaining (already late) falls under every threshold, so the
 * lowest one wins -- which is the intent of a 0-minute rule.
 */
export function colorForRemaining(
    remainingMs: number,
    thresholds: Threshold[],
    baseColor: string,
): string {
    const remainingMinutes = remainingMs / 60_000;
    for (const t of thresholds) {
        if (remainingMinutes <= t.minutes) return t.color;
    }
    return baseColor;
}

/**
 * Minutes before departure, from either form the user might reasonably type:
 * a plain count ("10", "2.5") or clock notation ("10:00", "1:30" = ninety seconds).
 * Every other field in this panel is HH:MM, so accepting "10:00" is not a nicety --
 * it is the form people actually reach for here.
 *
 * Blank means "off". Junk returns null rather than 0, which would otherwise fire the
 * threshold permanently.
 */
function parseMinutes(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (text === "") return null;

    const clock = /^(-?)(\d+):([0-5]?\d)$/.exec(text);
    if (clock) {
        const [, sign, mins, secs] = clock;
        const total = Number(mins) + Number(secs) / 60;
        return sign === "-" ? -total : total;
    }

    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}
