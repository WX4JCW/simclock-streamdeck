import streamDeck from "@elgato/streamdeck";

import { parseEpochSeconds } from "./ofp.js";

/**
 * Fetches the current OFP from SimBrief and exposes its scheduled off-block time.
 *
 * SOBT is `times/sched_out` -- the same field Datalink Pro treats as authoritative.
 * `sched_off` is takeoff and `sched_in` is arrival; neither is the departure time.
 *
 * An OFP only changes when the user regenerates it, so this polls slowly. Hammering
 * SimBrief's public API would be rude and risks a rate limit.
 */
const SIMBRIEF_URL = "https://www.simbrief.com/api/xml.fetcher.php";
const POLL_INTERVAL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Retry sooner after a failure than the normal slow cadence. */
const RETRY_INTERVAL_MS = 60_000;
/** Floor between on-demand refreshes, so placing several clocks isn't a burst. */
const MIN_REFRESH_INTERVAL_MS = 30_000;

type OfpResponse = {
    times?: { sched_out?: string | number };
    general?: { icao_airline?: string; flight_number?: string };
    origin?: { icao_code?: string };
    destination?: { icao_code?: string };
};

class SimBriefFeed {
    #username = "";
    #sobt: Date | null = null;
    #timer: NodeJS.Timeout | undefined;
    #inFlight = false;
    /** Avoids repeating the same failure in the log every minute. */
    #lastError = "";
    /** monotonic ms of the last completed fetch, to rate-limit on-demand refreshes. */
    #lastFetchAt = 0;
    /** Which query parameter SimBrief accepted for this account, once known. */
    #paramForm: "username" | "userid" | undefined;

    /** Scheduled off-block time, or null when there's no usable OFP. */
    get sobt(): Date | null {
        return this.#username === "" ? null : this.#sobt;
    }

    get hasUsername(): boolean {
        return this.#username !== "";
    }

    /**
     * Point the feed at a SimBrief account. Re-fetches immediately on a real change so
     * the display updates as soon as the user finishes typing, rather than up to five
     * minutes later.
     */
    setUsername(username: string | undefined): void {
        const next = (username ?? "").trim();
        if (next === this.#username) return;

        this.#username = next;
        this.#paramForm = undefined;
        this.#sobt = null;
        this.#lastError = "";
        this.#schedule(0);
    }

    start(): void {
        this.#schedule(0);
    }

    /**
     * Pull a fresh OFP now rather than waiting out the slow poll -- used when a SimBrief
     * clock is placed or reconfigured, so a regenerated flight plan shows up at once.
     * Rate-limited, so repeated placements can't turn into a burst of API calls.
     */
    refreshNow(): void {
        if (this.#username === "") return;
        if (performance.now() - this.#lastFetchAt < MIN_REFRESH_INTERVAL_MS) return;
        this.#schedule(0);
    }

    stop(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
    }

    #schedule(delayMs: number): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#poll(), delayMs);
    }

    async #poll(): Promise<void> {
        if (this.#username === "") {
            this.#schedule(POLL_INTERVAL_MS);
            return;
        }
        if (this.#inFlight) {
            this.#schedule(POLL_INTERVAL_MS);
            return;
        }

        this.#inFlight = true;
        let ok = false;
        try {
            // SimBrief takes a login name as `username` and a numeric Pilot ID as
            // `userid`, and answers 400 if you use the wrong one. Rather than making the
            // user know which they typed, try the likely form and fall back to the other,
            // remembering whichever the account accepts.
            const forms: Array<"username" | "userid"> =
                this.#paramForm !== undefined
                    ? [this.#paramForm]
                    : /^\d+$/.test(this.#username)
                      ? ["userid", "username"]
                      : ["username", "userid"];

            let res: Response | undefined;
            let used: "username" | "userid" | undefined;
            for (const form of forms) {
                const url =
                    `${SIMBRIEF_URL}?${form}=${encodeURIComponent(this.#username)}&json=1`;
                res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
                used = form;
                if (res.ok) break;
            }

            if (!res || !res.ok) {
                this.#fail(
                    `SimBrief rejected "${this.#username}" (HTTP ${res?.status ?? "?"}). ` +
                        "Check the spelling, and that the profile is publicly visible " +
                        "(simbrief.com -> Account -> Privacy).",
                );
            } else {
                this.#paramForm = used;
                const data = (await res.json()) as OfpResponse;
                const sobt = parseEpochSeconds(data.times?.sched_out);
                if (sobt === null) {
                    // Most often this is a profile that isn't publicly visible, or an
                    // account with no OFP generated yet.
                    this.#fail(
                        "SimBrief returned no scheduled departure. Check the username, " +
                            "that an OFP exists, and that the profile is publicly visible.",
                    );
                } else {
                    this.#sobt = sobt;
                    this.#lastError = "";
                    ok = true;
                }
            }
        } catch (err) {
            this.#fail(`SimBrief fetch failed: ${String(err)}`);
        } finally {
            this.#inFlight = false;
            this.#lastFetchAt = performance.now();
            this.#schedule(ok ? POLL_INTERVAL_MS : RETRY_INTERVAL_MS);
        }
    }

    #fail(message: string): void {
        this.#sobt = null;
        if (message !== this.#lastError) {
            streamDeck.logger.info(message);
            this.#lastError = message;
        }
    }
}

export const simBriefFeed = new SimBriefFeed();
