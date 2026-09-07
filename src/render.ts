import { resolveColor, resolveFont, DEFAULTS, type ClockSettings } from "./settings.js";

export type Target = "key" | "dial";

/**
 * Geometry per target. Key art is drawn at 144x144 (the @2x key size) and the dial at
 * 200x100 (one quarter of the Stream Deck + touch strip). Sizes are deliberately
 * conservative: the font family is user-supplied and we cannot measure text in Node,
 * so we leave headroom rather than risk a wide face overflowing the canvas.
 */
const GEOMETRY = {
    key: { w: 144, h: 144, headerY: 58, headerSize: 22, timeY: 110, timeSize: 46 },
    dial: { w: 200, h: 100, headerY: 38, headerSize: 18, timeY: 84, timeSize: 42 },
} as const;

/**
 * Fraction of the font size each character advances, for a semibold geometric sans.
 *
 * The font is user-selectable, so real metrics are unknowable here and these are
 * deliberately generous: over-estimating width makes text slightly smaller than it had
 * to be, while under-estimating clips it. Small is recoverable, clipped is not.
 */
const ADVANCE = { digit: 0.62, colon: 0.32, sign: 0.62, space: 0.30, other: 0.68 } as const;

/** Share of the canvas the text may occupy, leaving a visible margin at both edges. */
const SAFE_WIDTH_FRACTION = 0.92;

/** Estimated width of `text` rendered at `fontSize`, including letter-spacing. */
export function estimateTextWidth(text: string, fontSize: number, letterSpacing = 0): number {
    let advance = 0;
    for (const ch of text) {
        if (ch >= "0" && ch <= "9") advance += ADVANCE.digit;
        else if (ch === ":" || ch === ".") advance += ADVANCE.colon;
        else if (ch === "+" || ch === "-") advance += ADVANCE.sign;
        else if (ch === " ") advance += ADVANCE.space;
        else advance += ADVANCE.other;
    }
    return advance * fontSize + Math.max(0, text.length - 1) * letterSpacing;
}

/**
 * The largest size at or below `baseSize` that keeps `text` inside `canvasWidth`.
 *
 * Sizes are fixed for the common case -- a five-character HH:MM -- so anything longer
 * has to shrink rather than run off the key. "+12:34" past scheduled departure is the
 * case that bites, and a ten-character custom header is the other.
 */
export function fitFontSize(
    text: string,
    baseSize: number,
    canvasWidth: number,
    letterSpacing = 0,
): number {
    const safe = canvasWidth * SAFE_WIDTH_FRACTION;
    const estimate = estimateTextWidth(text, baseSize, letterSpacing);
    if (estimate <= safe || estimate <= 0) return baseSize;

    // Letter-spacing does not scale with the font, so solve for the size that fits.
    const spacing = Math.max(0, text.length - 1) * letterSpacing;
    const perUnit = (estimate - spacing) / baseSize;
    const fitted = perUnit > 0 ? (safe - spacing) / perUnit : baseSize;
    return Math.max(1, Math.floor(Math.min(baseSize, fitted)));
}

/**
 * Two centered lines -- header over HH:MM -- as an SVG data URI.
 * Both setImage (keys) and setFeedback (dials) accept this form.
 */
export function renderClock(
    settings: ClockSettings,
    target: Target,
    header: string,
    value: string,
    /** Overrides the configured time colour, used by the countdown's thresholds. */
    timeColorOverride?: string,
): string {
    const g = GEOMETRY[target];
    const font = xml(resolveFont(settings));
    const bg = resolveColor(settings.bgColor, DEFAULTS.bgColor);
    const headerColor = resolveColor(settings.headerColor, DEFAULTS.headerColor);
    const timeColor = resolveColor(timeColorOverride ?? settings.timeColor, DEFAULTS.timeColor);

    // Both lines shrink to fit rather than running off the edge: the time when a "+"
    // makes the countdown six characters, the header when a long custom label is typed.
    const headerSpacing = 1.5;
    const headerSize = fitFontSize(header, g.headerSize, g.w, headerSpacing);
    const timeSize = fitFontSize(value, g.timeSize, g.w);

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}">` +
        `<rect width="${g.w}" height="${g.h}" fill="${bg}"/>` +
        `<text x="${g.w / 2}" y="${g.headerY}" text-anchor="middle" ` +
        `font-family="${font}" font-size="${headerSize}" font-weight="600" ` +
        `letter-spacing="${headerSpacing}" fill="${headerColor}">${xml(header)}</text>` +
        `<text x="${g.w / 2}" y="${g.timeY}" text-anchor="middle" ` +
        `font-family="${font}" font-size="${timeSize}" font-weight="600" ` +
        `fill="${timeColor}">${xml(value)}</text>` +
        `</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Escape user-supplied text so a stray & or < cannot produce malformed SVG. */
function xml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
