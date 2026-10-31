import { DEFAULTS, resolveColor, resolveFont, type ClockSettings } from "./settings.js";

export type Target = "key" | "dial";

/**
 * One colour per SimClock function, as HSL hue and saturation. The Panel style (the same
 * look as the ChasePlane deck plugin) derives every shade on a key from these two numbers.
 */
export type Tone = "local" | "zulu" | "sim" | "std" | "countdown" | "late" | "chrono" | "timeline";
const TONES: Record<Tone, [number, number]> = {
    local: [170, 60],
    zulu: [212, 80],
    sim: [262, 60],
    std: [42, 90],
    countdown: [28, 95],
    late: [2, 80],
    chrono: [145, 65],
    timeline: [325, 60],
};

function hsl(h: number, s: number, l: number): string {
    const sat = s / 100;
    const light = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `#${[0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Key fill (deep), caption band, main text and "on" ring for a tone. */
export function panelColors(tone: Tone): { deep: string; band: string; text: string; on: string } {
    const [h, s] = TONES[tone];
    return { deep: hsl(h, s * 0.8, 11), band: hsl(h, s, 52), text: hsl(h, s, 78), on: hsl(h, s, 60) };
}

/** Black or white, whichever reads better on `background` (WCAG contrast). */
export function ink(background: string): string {
    const hex = background.length === 4 ? background.replace(/[0-9a-f]/gi, (c) => c + c) : background;
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#0A0A0A" : "#FFFFFF";
}

/**
 * What one key or dial section shows: a caption in the band, the value in the middle, an
 * optional status line at the bottom. `active` draws the ring; `accent` replaces the
 * tone's ring colour (a countdown threshold, the timeline's Due colour); `alert` also
 * fills the band with the accent, for a reminder that has fallen due.
 */
export type Look = {
    tone: Tone;
    caption: string;
    value: string;
    sub?: string;
    active?: boolean;
    accent?: string;
    alert?: boolean;
};

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
 * Captions are capitals, which run wider than the general estimate, so they are measured
 * at 0.72 of the font size per character, shrunk from 15px down to 10px on a key (14 to
 * 12 on a dial), and cut with an ellipsis only below that.
 */
const CAPS_GLYPH = 0.72;
function captionText(x: number, y: number, raw: string, fill: string, font: string, width: number, max: number, min: number): string {
    let value = raw.toUpperCase();
    let size = Math.min(max, Math.floor(width / (Math.max(1, value.length) * CAPS_GLYPH)));
    if (size < min) {
        size = min;
        value = `${value.slice(0, Math.floor(width / (size * CAPS_GLYPH)) - 1)}\u2026`;
    }
    return text(x, y, size, value, fill, font);
}

function text(x: number, y: number, size: number, value: string, fill: string, font: string): string {
    return (
        `<text x="${x}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${size}" ` +
        `font-weight="bold" fill="${fill}">${xml(value)}</text>`
    );
}

type Colors = ReturnType<typeof panelColors>;

/** The chosen family, then a sans-serif fallback so a name the renderer can't match never comes out serif. */
function fontStack(settings: ClockSettings): string {
    return `${xml(resolveFont(settings))}, Arial, sans-serif`;
}

/**
 * The Panel frame: tinted key, solid caption band, ring when active. Only flat shapes:
 * Stream Deck's SVG renderer did not draw blur or gradients in tests. Transparent drops
 * only the black behind the rounded corners, so the Action Wheel shows through there.
 */
function frame(settings: ClockSettings, target: Target, look: Look, font: string): { svg: string; colors: Colors } {
    const c = panelColors(look.tone);
    const band = look.alert && look.accent ? look.accent : c.band;
    const on = look.accent ?? c.on;
    const back = settings.bgTransparent === true;
    let svg: string;
    if (target === "key") {
        svg =
            (back ? "" : `<rect width="144" height="144" fill="#000000"/>`) +
            `<rect width="144" height="144" rx="18" fill="${c.deep}"/>` +
            `<rect width="144" height="30" rx="18" fill="${band}"/><rect y="16" width="144" height="14" fill="${band}"/>` +
            captionText(72, 21, look.caption, ink(band), font, 124, 15, 10) +
            (look.active ? `<rect x="3" y="3" width="138" height="138" rx="16" fill="none" stroke="${on}" stroke-width="5"/>` : "");
    } else {
        svg =
            (back ? "" : `<rect width="200" height="100" fill="#000000"/>`) +
            `<rect x="2" y="2" width="196" height="96" rx="14" fill="${c.deep}"/>` +
            `<rect x="2" y="2" width="196" height="24" rx="14" fill="${band}"/><rect x="2" y="14" width="196" height="12" fill="${band}"/>` +
            captionText(100, 19, look.caption, ink(band), font, 180, 14, 12) +
            (look.active ? `<rect x="4" y="4" width="192" height="92" rx="12" fill="none" stroke="${on}" stroke-width="3"/>` : "");
    }
    return { svg, colors: c };
}

function toUri(target: Target, body: string): string {
    const [w, h] = target === "key" ? [144, 144] : [200, 100];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Value colour: the tone's light shade, white when active, the accent for a countdown threshold. */
function valueColor(look: Look, c: Colors): string {
    if (look.accent && !look.alert) return look.accent;
    return look.active ? "#FFFFFF" : c.text;
}

/**
 * A clock: caption over the time, as an SVG data URI. Both setImage (keys) and
 * setFeedback (dials) accept this form. The time shrinks to fit rather than clipping,
 * which "+12:34" past scheduled departure needs.
 */
export function renderClock(settings: ClockSettings, target: Target, look: Look): string {
    if (settings.style === "classic") {
        return renderClassicClock(settings, target, look.caption, look.value, look.accent && !look.alert ? look.accent : undefined);
    }
    const font = fontStack(settings);
    const { svg, colors } = frame(settings, target, look, font);
    const key = target === "key";
    // The time is centred in the space under the band (30..144 on a key, 26..98 on a dial).
    const size = fitFontSize(look.value, key ? 44 : 40, key ? 140 : 200);
    const mid = key ? 87 : 62;
    const x = key ? 72 : 100;
    return toUri(target, svg + text(x, Math.round(mid + size * 0.36), size, look.value, valueColor(look, colors), font));
}

/**
 * Timeline geometry under the caption band: the reminder label, then a status line with
 * the countdown. The label is the line that matters, so it gets the space.
 *
 * `labelLines` is how many lines that label may wrap onto, and `labelHeight` the band it
 * has to do it in. A key is square and narrow, so WATER FUEL CATERING on one line shrinks
 * to about 10px, which is not readable at arm's length; over two lines it is twice that.
 * The dial is wide and only 100px tall, with no room to stack, so it stays at one line.
 */
const LINES_GEOMETRY = {
    key: { w: 144, labelMid: 74, labelSize: 26, labelWidth: 140, labelLines: 3, labelHeight: 66, subY: 131, subSize: 18 },
    dial: { w: 200, labelMid: 52, labelSize: 24, labelWidth: 200, labelLines: 1, labelHeight: 30, subY: 89, subSize: 16 },
} as const;

/** Baseline-to-baseline distance as a multiple of the font size, for a wrapped label. */
const LINE_HEIGHT = 1.15;

/**
 * Break `text` across up to `maxLines` lines and return the largest size that fits.
 *
 * One line is always in the running, so a label that already fits is left alone. An extra
 * line is taken only when it makes the text bigger: narrower lines allow a larger size,
 * but stacking them also divides `blockHeight`, and whichever limit bites first wins.
 */
export function fitWrapped(
    text: string,
    baseSize: number,
    canvasWidth: number,
    maxLines: number,
    blockHeight: number,
): { lines: string[]; size: number } {
    let best = { lines: [text], size: fitFontSize(text, baseSize, canvasWidth) };
    for (let n = 2; n <= maxLines; n++) {
        const lines = splitLines(text, n);
        if (lines.length < n) break; // Fewer words than lines; splitting further cannot help.
        const vertical = blockHeight / (n * LINE_HEIGHT);
        const widths = lines.map((line) => fitFontSize(line, baseSize, canvasWidth));
        const size = Math.max(1, Math.floor(Math.min(vertical, ...widths)));
        if (size > best.size) best = { lines, size };
    }
    return best;
}

/**
 * Split `text` at spaces into `n` lines of roughly equal width, or into fewer when there
 * are not enough words. Greedy from the left against an equal share of the total width,
 * which is all the two- and three-word labels this is used on need.
 */
function splitLines(text: string, n: number): string[] {
    const words = text.split(/\s+/).filter((w) => w !== "");
    if (words.length < n) return words.length > 0 ? words : [text];

    const share = words.reduce((sum, w) => sum + estimateTextWidth(w, 1), 0) / n;

    const lines: string[] = [];
    let current: string[] = [];
    let width = 0;
    let placed = 0;
    for (const word of words) {
        const w = estimateTextWidth(word, 1);
        const linesLeft = n - lines.length;
        const wordsLeft = words.length - placed;
        // Break before this word once the line has had its share, provided there is still
        // a line to break onto and enough words left to fill every remaining one.
        if (current.length > 0 && linesLeft > 1 && wordsLeft >= linesLeft - 1 && width + w / 2 > share) {
            lines.push(current.join(" "));
            current = [];
            width = 0;
        }
        current.push(word);
        width += w;
        placed++;
    }
    lines.push(current.join(" "));
    return lines;
}

/**
 * The timeline: caption, the reminder label (wrapped on a key), and a status line with
 * the countdown, in the Panel style.
 */
export function renderLines(settings: ClockSettings, target: Target, look: Look): string {
    if (settings.style === "classic") {
        const header = resolveColor(settings.headerColor, DEFAULTS.headerColor);
        const time = resolveColor(settings.timeColor, DEFAULTS.timeColor);
        const top = look.alert && look.accent ? look.accent : header;
        const label = look.alert && look.accent ? look.accent : time;
        return renderClassicLines(settings, target, [
            { text: look.caption, color: top },
            { text: look.value, color: label },
            { text: look.sub ?? "", color: time },
        ]);
    }
    const g = LINES_GEOMETRY[target];
    const font = fontStack(settings);
    const { svg, colors } = frame(settings, target, look, font);
    const fitted = fitWrapped(look.value, g.labelSize, g.labelWidth, g.labelLines, g.labelHeight);
    const leading = fitted.size * LINE_HEIGHT;
    // The block is centred on the label's middle, between the band and the status line.
    const first = g.labelMid + fitted.size * 0.36 - ((fitted.lines.length - 1) * leading) / 2;
    const fill = look.active ? "#FFFFFF" : colors.text;
    let body = "";
    fitted.lines.forEach((line, n) => {
        body += text(g.w / 2, Math.round(first + n * leading), fitted.size, line, fill, font);
    });
    if (look.sub) {
        const sub = look.sub.toUpperCase();
        const subFill = look.active ? (look.accent ?? colors.on) : colors.text;
        body += text(g.w / 2, g.subY, fitFontSize(sub, g.subSize, g.labelWidth), sub, subFill, font);
    }
    return toUri(target, svg + body);
}

// ---- Classic style: the look before Panel, kept as a choice in the Property Inspector ----

/**
 * Classic geometry per target. Key art is drawn at 144x144 (the @2x key size) and the dial at
 * 200x100 (one quarter of the Stream Deck + touch strip). Sizes are deliberately
 * conservative: the font family is user-supplied and we cannot measure text in Node,
 * so we leave headroom rather than risk a wide face overflowing the canvas.
 */
const CLASSIC_GEOMETRY = {
    key: { w: 144, h: 144, headerY: 58, headerSize: 22, timeY: 110, timeSize: 46 },
    dial: { w: 200, h: 100, headerY: 38, headerSize: 18, timeY: 84, timeSize: 42 },
} as const;

/**
 * The Classic style: two centered lines -- header over HH:MM -- in the colours chosen
 * in the Property Inspector.
 */
function renderClassicClock(
    settings: ClockSettings,
    target: Target,
    header: string,
    value: string,
    /** Overrides the configured time colour, used by the countdown's thresholds. */
    timeColorOverride?: string,
): string {
    const g = CLASSIC_GEOMETRY[target];
    const font = xml(resolveFont(settings));
    // Transparent means simply not drawing the rectangle. It matters inside Stream Deck's
    // Action Wheel, whose blue gradient is drawn behind the action -- an opaque fill here
    // paints straight over it. SVG is transparent by default, so omitting is the whole fix.
    const transparent = settings.bgTransparent === true;
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
        (transparent ? "" : `<rect width="${g.w}" height="${g.h}" fill="${bg}"/>`) +
        `<text x="${g.w / 2}" y="${g.headerY}" text-anchor="middle" ` +
        `font-family="${font}" font-size="${headerSize}" font-weight="600" ` +
        `letter-spacing="${headerSpacing}" fill="${headerColor}">${xml(header)}</text>` +
        `<text x="${g.w / 2}" y="${g.timeY}" text-anchor="middle" ` +
        `font-family="${font}" font-size="${timeSize}" font-weight="600" ` +
        `fill="${timeColor}">${xml(value)}</text>` +
        `</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Classic three-line geometry for the departure timeline: a small status line, the reminder
 * label, and a countdown. The label is the line that matters, so it gets the space.
 *
 * `labelLines` is how many lines that label may wrap onto, and `labelHeight` the band it
 * has to do it in. A key is square and narrow, so WATER FUEL CATERING on one line shrinks
 * to about 10px, which is not readable at arm's length; over two lines it is twice that.
 * The dial is wide and only 100px tall, with no room to stack, so it stays at one line.
 */
const CLASSIC_LINES = {
    key: { w: 144, h: 144, ys: [38, 84, 126], sizes: [20, 26, 28], labelLines: 3, labelHeight: 56 },
    dial: { w: 200, h: 100, ys: [24, 60, 92], sizes: [16, 26, 22], labelLines: 1, labelHeight: 30 },
} as const;

/** One line of a three-line drawing; `color` is already resolved. */
export type Line = { text: string; color: string };

/**
 * The Classic timeline: status / label / countdown, each line shrunk to fit like the clock.
 * Colours are passed in resolved, because which line is highlighted depends on state.
 */
function renderClassicLines(settings: ClockSettings, target: Target, lines: [Line, Line, Line]): string {
    const g = CLASSIC_LINES[target];
    const font = xml(resolveFont(settings));
    const transparent = settings.bgTransparent === true;
    const bg = resolveColor(settings.bgColor, DEFAULTS.bgColor);

    let body = "";
    lines.forEach((line, i) => {
        const row = i as 0 | 1 | 2;
        const spacing = row === 0 ? 1.5 : 0;
        // Only the label is worth wrapping; the status and countdown rows are short and
        // belong on the single line the geometry puts them on.
        const fitted =
            row === 1
                ? fitWrapped(line.text, g.sizes[row], g.w, g.labelLines, g.labelHeight)
                : { lines: [line.text], size: fitFontSize(line.text, g.sizes[row], g.w, spacing) };
        // The block is centred on the row's baseline, so a single line lands exactly where
        // it always did and nothing else on the canvas has to move.
        const leading = fitted.size * LINE_HEIGHT;
        const first = g.ys[row] - ((fitted.lines.length - 1) * leading) / 2;
        fitted.lines.forEach((text, n) => {
            body +=
                `<text x="${g.w / 2}" y="${first + n * leading}" text-anchor="middle" ` +
                `font-family="${font}" font-size="${fitted.size}" font-weight="600" ` +
                `letter-spacing="${spacing}" fill="${line.color}">${xml(text)}</text>`;
        });
    });

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}">` +
        (transparent ? "" : `<rect width="${g.w}" height="${g.h}" fill="${bg}"/>`) +
        body +
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
