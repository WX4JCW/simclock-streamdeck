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

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}">` +
        `<rect width="${g.w}" height="${g.h}" fill="${bg}"/>` +
        `<text x="${g.w / 2}" y="${g.headerY}" text-anchor="middle" ` +
        `font-family="${font}" font-size="${g.headerSize}" font-weight="600" ` +
        `letter-spacing="1.5" fill="${headerColor}">${xml(header)}</text>` +
        `<text x="${g.w / 2}" y="${g.timeY}" text-anchor="middle" ` +
        `font-family="${font}" font-size="${g.timeSize}" font-weight="600" ` +
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
