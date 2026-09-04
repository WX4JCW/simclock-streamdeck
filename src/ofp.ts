/**
 * SimBrief reports times as epoch seconds, sometimes as a string.
 * Rejects absent, zero, malformed, or absurd values rather than producing a date in
 * 1970 or the year 4000 that would render as a plausible-looking clock reading.
 */
export function parseEpochSeconds(value: string | number | undefined | null): Date | null {
    if (value === undefined || value === null || value === "") return null;
    const seconds = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;

    const date = new Date(seconds * 1000);
    const year = date.getUTCFullYear();
    return year >= 2000 && year <= 2100 ? date : null;
}
