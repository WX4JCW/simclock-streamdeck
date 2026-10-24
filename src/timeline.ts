/**
 * Departure timeline: reminders at fixed minutes before scheduled off-block.
 *
 * Pure logic only -- no Stream Deck, no clocks -- so the whole decision of "what does the
 * dial say right now" can be tested by passing in a remaining time.
 */

/** One reminder: due when `minutes` or fewer remain to SOBT. */
export type TimelineItem = { minutes: number; label: string };

/**
 * Default list, from the AA 737 departure sequence (D-15 briefing, D-10 Before Start,
 * D-3 doors, D-2 push) plus the ground-service order the owner flies with.
 */
export const DEFAULT_TIMELINE_TEXT = [
    "60 WATER FUEL CATERING",
    "35 BOARDING",
    "15 DEPARTURE BRIEF",
    "10 BEFORE START A",
    "7 OK TO CLOSE",
    "3 BEFORE START",
    "2 REQUEST PUSH",
].join("\n");

/**
 * Parse the settings text: one reminder per line, minutes first, then the label.
 * Accepts `35 BOARDING`, `D-35 BOARDING`, `35: BOARDING` and `35=BOARDING`.
 * Lines without a leading number or without a label are skipped rather than guessed at.
 * Sorted earliest-first (largest minutes first), which is the order they fall due.
 */
export function parseTimeline(text: string | undefined): TimelineItem[] {
    const source = text === undefined || text.trim() === "" ? DEFAULT_TIMELINE_TEXT : text;
    const items: TimelineItem[] = [];
    for (const raw of source.split(/\r?\n/)) {
        // A separator is required, or "35" alone would parse as 3 minutes, label "5".
        const m = /^\s*(?:D\s*-\s*)?(\d{1,3})(?:\s*[:=]\s*|\s+)(.+?)\s*$/i.exec(raw);
        const label = m?.[2]?.trim() ?? "";
        if (!m || label === "") continue;
        items.push({ minutes: Number(m[1]), label: label.toUpperCase() });
    }
    return items.sort((a, b) => b.minutes - a.minutes);
}

/** What the timeline shows at one moment. */
export type TimelineView =
    | { kind: "due"; item: TimelineItem; next: TimelineItem | null }
    | { kind: "next"; item: TimelineItem; inMs: number }
    | { kind: "done" };

/**
 * Decide what to show with `remainingMs` to SOBT.
 *
 * The most recently due item is shown as DUE until it is acknowledged or the next item
 * falls due, so a missed reminder is superseded rather than piling up. Otherwise the
 * next item not yet due is shown with the time until it. Once every item is past (and
 * the last acknowledged) the timeline is done.
 */
export function timelineView(
    items: TimelineItem[],
    remainingMs: number,
    acknowledged: ReadonlySet<number>,
): TimelineView {
    const remainingMin = remainingMs / 60_000;
    let lastDue = -1;
    items.forEach((item, i) => {
        if (remainingMin <= item.minutes) lastDue = i;
    });

    const due = items[lastDue];
    if (due && !acknowledged.has(due.minutes)) {
        return { kind: "due", item: due, next: items[lastDue + 1] ?? null };
    }

    const upcoming = items[lastDue + 1];
    if (upcoming) {
        return { kind: "next", item: upcoming, inMs: remainingMs - upcoming.minutes * 60_000 };
    }
    return { kind: "done" };
}

/** `D-35`, the way the AA sequence writes it. */
export function dLabel(minutes: number): string {
    return `D-${minutes}`;
}
