/** Per-dial chronometer. Dialing in a duration counts down; starting from zero counts up. */
export type ChronoState = "idle" | "running" | "stopped";

const MINUTE_MS = 60_000;
const MAX_SET_MS = 99 * MINUTE_MS;

export class Chrono {
    state: ChronoState = "idle";
    /** Dialed-in target. 0 means count up rather than down. */
    setMs = 0;
    #startedAt = 0;
    #accumMs = 0;

    /** Rotating only edits the target while idle, so a knock mid-timing can't rewrite it. */
    rotate(ticks: number): void {
        if (this.state !== "idle") return;
        this.setMs = clamp(this.setMs + ticks * MINUTE_MS, 0, MAX_SET_MS);
    }

    toggle(): void {
        if (this.state === "running") {
            this.#accumMs = this.elapsedMs();
            this.state = "stopped";
        } else {
            this.#startedAt = performance.now();
            this.state = "running";
        }
    }

    reset(): void {
        this.state = "idle";
        this.setMs = 0;
        this.#accumMs = 0;
        this.#startedAt = 0;
    }

    elapsedMs(): number {
        if (this.state !== "running") return this.#accumMs;
        return this.#accumMs + (performance.now() - this.#startedAt);
    }

    /** Remaining time when counting down; elapsed when counting up. */
    displayMs(): number {
        if (this.setMs > 0) return Math.max(0, this.setMs - this.elapsedMs());
        return this.elapsedMs();
    }

    /** True once a countdown has run out, so the caller can stop it. */
    hasExpired(): boolean {
        return this.setMs > 0 && this.state === "running" && this.elapsedMs() >= this.setMs;
    }

    /** Whether the chronometer should take over the display instead of the clock. */
    isActive(): boolean {
        return this.state !== "idle" || this.setMs > 0;
    }
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}
