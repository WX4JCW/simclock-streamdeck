import { simFeed } from "./sim-feed.js";
import type { TimeSource } from "./settings.js";

/**
 * Current time for a source, or null when it cannot be known.
 * Only "sim" can return null; the PC clock is always readable.
 */
export function timeFor(source: TimeSource): Date | null {
    switch (source) {
        case "sim":
            return simFeed.now();
        case "zulu":
        case "pc":
        default:
            return new Date();
    }
}
