import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Installed font family names, read from the Windows font registry.
 *
 * The Property Inspector is a sandboxed browser page and cannot see the font list, so the
 * plugin reads it and hands it over. Scanning C:\Windows\Fonts is no use -- that gives
 * file names like AGENCYR.TTF, not the family name CSS needs.
 */
const FONT_KEYS = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
];

/**
 * Turn a registry value name into the family name a user would type.
 *
 * Entries arrive as "Agency FB Bold (TrueType)", sometimes with localized aliases joined
 * by commas: "Arial Bold,Arial Negrita". Keep the first alias, drop the format suffix.
 * Returns null for anything left empty, so junk cannot reach the dropdown.
 */
export function cleanFontName(raw: string): string | null {
    let name = raw.split(",")[0] ?? "";
    name = name.replace(/\s*\((?:TrueType|OpenType|All res|VGA res|\d+\s*dpi)\)\s*$/i, "");
    name = name.trim();
    return name.length > 0 ? name : null;
}

/**
 * Weight and slant words Windows appends to a family in the registry.
 *
 * Width words -- Condensed, Narrow, Expanded -- are deliberately absent: those are part
 * of the family name ("Bahnschrift Condensed" is its own family), not a style of it.
 */
const STYLE_WORDS = new Set([
    "thin", "extralight", "ultralight", "light", "regular", "normal", "book",
    "medium", "semibold", "demibold", "bold", "extrabold", "ultrabold",
    "black", "heavy", "italic", "oblique",
]);

/**
 * The base family for a style-qualified name, or null when there is no style to strip.
 *
 * The registry lists "Open Sans Regular" and "Open Sans Bold" but never plain
 * "Open Sans", yet that is the name people type and the one CSS resolves. Returning the
 * base only when a style word was actually removed keeps invented names out of the list.
 */
export function baseFamily(name: string): string | null {
    const words = name.split(" ").filter((w) => w.length > 0);
    let end = words.length;
    while (end > 1 && STYLE_WORDS.has((words[end - 1] ?? "").toLowerCase())) end--;
    if (end === words.length) return null;
    const base = words.slice(0, end).join(" ");
    return base.length > 0 ? base : null;
}

/** Parse `reg query` output into cleaned, de-duplicated family names. */
export function parseRegistryFonts(stdout: string): string[] {
    const names = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
        // "    Agency FB (TrueType)    REG_SZ    AGENCYR.TTF"
        const match = /^\s{4,}(.+?)\s{2,}REG_[A-Z_]+\s{2,}/.exec(line);
        if (!match?.[1]) continue;
        const name = cleanFontName(match[1]);
        if (name === null) continue;
        names.add(name);
        // Offer the family itself as well as its styles, since the registry never
        // lists the bare family but it is the name most people reach for.
        const base = baseFamily(name);
        if (base !== null) names.add(base);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

/** Every installed family, machine-wide and per-user. Empty if the registry is unreadable. */
export async function listInstalledFonts(): Promise<string[]> {
    const names = new Set<string>();
    for (const key of FONT_KEYS) {
        try {
            const { stdout } = await run("reg", ["query", key], {
                windowsHide: true,
                maxBuffer: 4 * 1024 * 1024,
            });
            for (const name of parseRegistryFonts(stdout)) names.add(name);
        } catch {
            // A missing per-user key is normal; a missing machine key leaves the dropdown
            // empty, and the field still accepts a typed name.
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}
