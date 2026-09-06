/**
 * A self-scheduling loop whose interval is decided fresh after every cycle.
 *
 * The interval is deliberately variable: a plain HH:MM clock only needs waking on the
 * minute, while a countdown or a running chronometer needs a second. That saves fifty-nine
 * pointless wake-ups a minute, but it introduces a trap -- once asleep for a long
 * interval, nothing shortens it. An instance appearing, or settings changing, can raise
 * the required cadence while the loop is parked, leaving the display frozen until the
 * stale timer happens to fire.
 *
 * `wake()` is the answer to that: it cancels a pending sleep and runs now.
 */
export class Ticker {
    #timer: ReturnType<typeof setTimeout> | undefined;
    #inCycle = false;
    #stopped = false;

    /**
     * @param run Work to perform each cycle.
     * @param nextDelayMs Milliseconds to wait before the next cycle, asked for after each.
     * @param onError Reports a failing cycle; the loop continues regardless.
     */
    constructor(
        private readonly run: () => Promise<void>,
        private readonly nextDelayMs: () => number,
        private readonly onError: (err: unknown) => void = () => {},
    ) {}

    start(): void {
        this.#stopped = false;
        this.#schedule(0);
    }

    stop(): void {
        this.#stopped = true;
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.#timer = undefined;
    }

    /**
     * Run now instead of waiting out a pending sleep.
     *
     * A wake arriving mid-cycle is ignored on purpose: that cycle already ends by asking
     * `nextDelayMs()` again, which sees the new state anyway. Scheduling another run would
     * only double the work.
     */
    wake(): void {
        if (this.#stopped || this.#inCycle) return;
        this.#schedule(0);
    }

    #schedule(delayMs: number): void {
        if (this.#stopped) return;
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#cycle(), delayMs);
    }

    async #cycle(): Promise<void> {
        this.#timer = undefined;
        this.#inCycle = true;
        try {
            await this.run();
        } catch (err) {
            this.onError(err);
        } finally {
            this.#inCycle = false;
            this.#schedule(this.nextDelayMs());
        }
    }
}
