import streamDeck, {
    action,
    SingletonAction,
    type DialAction,
    type DialDownEvent,
    type DialRotateEvent,
    type DialUpEvent,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type KeyAction,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from "@elgato/streamdeck";

import { Chrono } from "./chrono.js";
import { formatChrono, formatCountdown, formatHHMM } from "./format.js";
import { renderClock } from "./render.js";
import { msUntilNextMinute } from "./schedule.js";
import {
    DEFAULTS,
    defaultHeader,
    LATE_LABEL,
    needsSimBrief,
    needsSimBridge,
    resolveColor,
    resolveHeader,
    resolveSource,
    type ClockSettings,
} from "./settings.js";
import { simBriefFeed } from "./simbrief-feed.js";
import { colorForRemaining, readThresholds } from "./thresholds.js";
import { timeFor } from "./time-source.js";

/** Press longer than this resets the chronometer instead of starting/stopping it. */
const LONG_PRESS_MS = 600;

/** A placed instance of this action -- a key, or a Stream Deck + dial. */
type ClockInstance = DialAction<ClockSettings> | KeyAction<ClockSettings>;

/** Everything tracked per placed instance. */
type InstanceState = {
    settings: ClockSettings;
    /** Bumped whenever settings change, so the draw signature invalidates. */
    revision: number;
    /** Signature of the last drawing actually sent to Stream Deck. */
    lastDrawn: string;
    chrono: Chrono | undefined;
    pressedAt: number | undefined;
};

@action({ UUID: "com.acms.simclock.clock" })
export class ClockAction extends SingletonAction<ClockSettings> {
    readonly #state = new Map<string, InstanceState>();

    override async onWillAppear(ev: WillAppearEvent<ClockSettings>): Promise<void> {
        this.#stateFor(ev.action.id).settings = ev.payload.settings ?? {};
        this.#refreshFeedsFor(ev.action.id);
        await this.render(ev.action);
    }

    override onWillDisappear(ev: WillDisappearEvent<ClockSettings>): void {
        this.#state.delete(ev.action.id);
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<ClockSettings>,
    ): Promise<void> {
        const state = this.#stateFor(ev.action.id);
        state.settings = ev.payload.settings ?? {};
        state.revision++;
        this.#refreshFeedsFor(ev.action.id);
        await this.render(ev.action);
    }

    /**
     * Pressing a key refetches the OFP. Dials use press for the chronometer, so this is
     * key-only -- it is the natural "I just regenerated my flight plan" gesture, and
     * without it the only way to force a refresh was to go and edit a setting.
     */
    override async onKeyDown(ev: KeyDownEvent<ClockSettings>): Promise<void> {
        const state = this.#stateFor(ev.action.id);
        if (!needsSimBrief(resolveSource(state.settings))) return;

        simBriefFeed.refreshNow();
        // Force the next draw even if the value is unchanged, so the press visibly
        // registers rather than looking like nothing happened.
        state.lastDrawn = "";
        await this.render(ev.action);
    }

    override async onDialRotate(ev: DialRotateEvent<ClockSettings>): Promise<void> {
        this.#chronoFor(ev.action.id).rotate(ev.payload.ticks);
        await this.render(ev.action);
    }

    override onDialDown(ev: DialDownEvent<ClockSettings>): void {
        this.#stateFor(ev.action.id).pressedAt = performance.now();
    }

    override async onDialUp(ev: DialUpEvent<ClockSettings>): Promise<void> {
        const state = this.#stateFor(ev.action.id);
        const held = state.pressedAt !== undefined ? performance.now() - state.pressedAt : 0;
        state.pressedAt = undefined;

        const chrono = this.#chronoFor(ev.action.id);
        if (held >= LONG_PRESS_MS) {
            chrono.reset();
        } else {
            chrono.toggle();
        }
        await this.render(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent<ClockSettings>): Promise<void> {
        this.#chronoFor(ev.action.id).toggle();
        await this.render(ev.action);
    }

    /** Re-draw every visible instance; driven by the plugin's ticker. */
    async renderAll(): Promise<void> {
        for (const instance of this.actions) {
            await this.render(instance);
        }
    }

    /**
     * How long until the display could next change.
     *
     * A running chronometer changes every second. So does a sim clock, because time
     * compression makes sim minutes elapse faster than real ones -- scheduling against
     * real minute boundaries would miss them. Everything else only changes on the minute,
     * so we sleep until then instead of waking sixty times to redraw nothing.
     */
    nextTickDelayMs(): number {
        let needsSeconds = false;
        for (const instance of this.actions) {
            const state = this.#state.get(instance.id);
            if (state?.chrono?.state === "running") return 1000;
            const source = resolveSource(state?.settings ?? {});
            // Sim clocks and the countdown both move with sim time, which compression
            // makes elapse faster than real time; real minute boundaries would miss it.
            if (source === "sim" || source === "tostd") needsSeconds = true;
        }
        if (needsSeconds) return 1000;

        return msUntilNextMinute(Date.now());
    }

    /** True when any placed clock reads the simulator, so the bridge is worth running. */
    anyNeedsSimBridge(): boolean {
        for (const instance of this.actions) {
            const state = this.#state.get(instance.id);
            if (needsSimBridge(resolveSource(state?.settings ?? {}))) return true;
        }
        return false;
    }

    /**
     * Draw one instance, skipping the Stream Deck round-trip when nothing visible changed.
     * Settings come from the cache populated by willAppear/didReceiveSettings, so the
     * common path costs no IPC at all: a clock redraws once a minute, not once a second.
     */
    async render(target: ClockInstance): Promise<void> {
        const state = this.#stateFor(target.id);
        const isDial = target.isDial();
        const { header, value, timeColor } = this.#readout(state, isDial);

        // The colour is part of the signature: a threshold crossing changes nothing but
        // the colour, and would otherwise be skipped as an identical draw.
        const signature =
            `${state.revision}|${isDial ? "d" : "k"}|${header}|${value}|${timeColor ?? ""}`;
        if (signature === state.lastDrawn) return;

        const image = renderClock(
            state.settings,
            isDial ? "dial" : "key",
            header,
            value,
            timeColor,
        );
        try {
            if (target.isDial()) {
                await target.setFeedback({ canvas: image });
            } else {
                await target.setImage(image);
            }
            state.lastDrawn = signature;
        } catch (err) {
            streamDeck.logger.warn(`Failed to draw clock ${target.id}: ${String(err)}`);
        }
    }

    /** The two lines to draw: the clock, or the chronometer when one is set or running. */
    #readout(
        state: InstanceState,
        isDial: boolean,
    ): { header: string; value: string; timeColor?: string } {
        const chrono = state.chrono;
        if (isDial && chrono?.isActive()) {
            if (chrono.hasExpired()) chrono.toggle();
            return {
                header: chrono.state === "idle" ? "SET" : "CHR",
                value: formatChrono(chrono.displayMs()),
            };
        }

        const source = resolveSource(state.settings);

        if (source === "tostd") {
            const sobt = simBriefFeed.sobt;
            const simNow = timeFor("sim");
            const { text, late } = formatCountdown(sobt, simNow);

            // Thresholds only mean something when there is a real countdown to colour;
            // with no OFP or no sim clock the placeholder keeps the base colour.
            const timeColor =
                sobt !== null && simNow !== null
                    ? colorForRemaining(
                          sobt.getTime() - simNow.getTime(),
                          readThresholds(state.settings),
                          resolveColor(state.settings.timeColor, DEFAULTS.timeColor),
                      )
                    : undefined;

            return {
                header: resolveHeader(state.settings, late ? LATE_LABEL : defaultHeader(source)),
                value: text,
                timeColor,
            };
        }

        const value =
            source === "std"
                ? formatHHMM(simBriefFeed.sobt, source)
                : formatHHMM(timeFor(source), source);

        return {
            header: resolveHeader(state.settings, defaultHeader(source)),
            value,
        };
    }

    /** Pull a fresh OFP when an instance that needs one appears or is reconfigured. */
    #refreshFeedsFor(id: string): void {
        const state = this.#state.get(id);
        if (state && needsSimBrief(resolveSource(state.settings))) {
            simBriefFeed.refreshNow();
        }
    }

    #stateFor(id: string): InstanceState {
        let state = this.#state.get(id);
        if (!state) {
            state = {
                settings: {},
                revision: 0,
                lastDrawn: "",
                chrono: undefined,
                pressedAt: undefined,
            };
            this.#state.set(id, state);
        }
        return state;
    }

    #chronoFor(id: string): Chrono {
        const state = this.#stateFor(id);
        state.chrono ??= new Chrono();
        return state.chrono;
    }
}
