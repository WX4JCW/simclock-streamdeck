import streamDeck from "@elgato/streamdeck";

/** Shape served by the Python bridge on 127.0.0.1:BRIDGE_PORT. */
type BridgePayload = {
    ok: boolean;
    /** Sim UTC as epoch milliseconds, or null when the sim clock is unreadable. */
    sim_utc_ms: number | null;
    /** Sim seconds elapsed per real second (1.0 = normal, 4.0 = 4x compression). */
    rate: number;
    sim_connected: boolean;
};

const BRIDGE_URL = "http://127.0.0.1:47600/time";
const POLL_INTERVAL_MS = 1000;
/** Drop to "no sim" after this long without a good sample, so we never show a stale clock. */
const STALE_AFTER_MS = 6000;

/**
 * Polls the SimConnect bridge and extrapolates between samples.
 *
 * The bridge reads ABSOLUTE_TIME through Python-SimConnect, whose AircraftRequests
 * cache TTL is 2000 ms and must not be lowered (lowering it drains the message queue
 * and every read comes back None). So samples are coarse by construction: we anchor on
 * each one and advance locally from a monotonic clock, scaled by the sim's time rate so
 * that time compression in cruise doesn't make the display jump on every sample.
 */
class SimFeed {
    /** Sim UTC at the moment of the last good sample. */
    #anchorSimMs: number | null = null;
    /** performance.now() reading paired with #anchorSimMs. */
    #anchorLocalMs = 0;
    /** Wall-clock time of the last good sample, for staleness. */
    #lastGoodAt = 0;
    #rate = 1;
    #connected = false;
    #timer: NodeJS.Timeout | undefined;
    #warned = false;

    start(): void {
        if (this.#timer) return;
        void this.#poll();
        this.#timer = setInterval(() => void this.#poll(), POLL_INTERVAL_MS);
    }

    stop(): void {
        if (!this.#timer) return;
        clearInterval(this.#timer);
        this.#timer = undefined;
    }

    /** True when the bridge is up and MSFS is reporting a usable clock. */
    get isConnected(): boolean {
        return this.#connected && !this.#isStale();
    }

    /**
     * Current sim UTC, extrapolated from the last sample, or null when unavailable.
     * Callers must render a placeholder rather than substituting real time -- showing
     * PC time under a "SIM" header would be worse than showing nothing.
     */
    now(): Date | null {
        if (this.#anchorSimMs === null || !this.isConnected) return null;
        const elapsed = performance.now() - this.#anchorLocalMs;
        return new Date(this.#anchorSimMs + elapsed * this.#rate);
    }

    #isStale(): boolean {
        return Date.now() - this.#lastGoodAt > STALE_AFTER_MS;
    }

    async #poll(): Promise<void> {
        try {
            const res = await fetch(BRIDGE_URL, {
                signal: AbortSignal.timeout(POLL_INTERVAL_MS - 100),
            });
            if (!res.ok) return this.#markDown();

            const data = (await res.json()) as BridgePayload;
            if (!data.ok || !data.sim_connected || data.sim_utc_ms === null) {
                return this.#markDown();
            }

            this.#anchorSimMs = data.sim_utc_ms;
            this.#anchorLocalMs = performance.now();
            this.#lastGoodAt = Date.now();
            this.#rate = Number.isFinite(data.rate) && data.rate > 0 ? data.rate : 1;
            if (!this.#connected) streamDeck.logger.info("Sim bridge connected.");
            this.#connected = true;
            this.#warned = false;
        } catch {
            // Bridge not running is the normal case when the user isn't flying; log once.
            if (!this.#warned) {
                streamDeck.logger.info(`Sim bridge unreachable at ${BRIDGE_URL}.`);
                this.#warned = true;
            }
            this.#markDown();
        }
    }

    #markDown(): void {
        this.#connected = false;
        this.#anchorSimMs = null;
    }
}

export const simFeed = new SimFeed();
