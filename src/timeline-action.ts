import streamDeck, {
    action,
    SingletonAction,
    type DialAction,
    type DialDownEvent,
    type DialRotateEvent,
    type DialUpEvent,
    type DidReceiveSettingsEvent,
    type KeyAction,
    type KeyDownEvent,
    type KeyUpEvent,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from "@elgato/streamdeck";

import { formatChrono, NO_TIME } from "./format.js";
import { renderLines, type Line } from "./render.js";
import { DEFAULTS, resolveColor, type ClockSettings } from "./settings.js";
import { simBriefFeed } from "./simbrief-feed.js";
import {
    dLabel,
    DEFAULT_TIMELINE_TEXT,
    parseTimeline,
    timelineView,
    type TimelineItem,
} from "./timeline.js";
import { timeFor } from "./time-source.js";

/** Press longer than this resets the acknowledgements (and restarts a demo). */
const LONG_PRESS_MS = 600;

/** A browsed item stays on screen this long after the last turn, then the dial returns. */
const BROWSE_TIMEOUT_MS = 10_000;

/** Demo SOBT, in minutes from when the demo starts, when none is entered. */
const DEFAULT_DEMO_MINUTES = 62;

const DEFAULT_DUE_COLOR = "#FFD400";

export type TimelineSettings = ClockSettings & {
    /** One reminder per line: minutes before SOBT, then the label. */
    items?: string;
    /** Run on the PC clock against a pretend SOBT, so the list can be tuned without MSFS. */
    demo?: boolean;
    demoMinutes?: string;
    dueColor?: string;
};

type TimelineInstance = DialAction<TimelineSettings> | KeyAction<TimelineSettings>;

type InstanceState = {
    settings: TimelineSettings;
    revision: number;
    lastDrawn: string;
    /** Minutes of the items acknowledged with a press, for the current SOBT. */
    acknowledged: Set<number>;
    /** The SOBT the acknowledgements belong to; a new OFP clears them. */
    ackFor: number | undefined;
    /** Index being browsed with the dial, and when it was last turned. */
    browse: { index: number; at: number } | undefined;
    /** Demo clock: real time it started, plus how far the dial has scrubbed it. */
    demo: { startedAt: number; offsetMs: number } | undefined;
    pressedAt: number | undefined;
};

@action({ UUID: "com.acms.simclock.timeline" })
export class TimelineAction extends SingletonAction<TimelineSettings> {
    readonly #state = new Map<string, InstanceState>();

    onCadenceChanged: (() => void) | undefined;

    override async onWillAppear(ev: WillAppearEvent<TimelineSettings>): Promise<void> {
        const state = this.#stateFor(ev.action.id);
        state.settings = ev.payload.settings ?? {};
        await this.#seedItems(ev.action, state);
        this.#refreshFeedsFor(ev.action.id);
        this.onCadenceChanged?.();
        await this.render(ev.action);
    }

    /**
     * Switching Stream Deck pages makes every instance disappear and reappear, so the
     * state kept here has to outlive it. Acknowledgements belong to the departure, not to
     * the page: dropping them meant flipping pages mid-turnaround brought every reminder
     * already cleared back as DUE. The demo clock is the same -- it is tied to the pretend
     * departure, not to the page. Only what belongs to the drawing is reset.
     */
    override onWillDisappear(ev: WillDisappearEvent<TimelineSettings>): void {
        const state = this.#state.get(ev.action.id);
        if (state === undefined) return;
        state.browse = undefined;
        state.pressedAt = undefined;
        state.lastDrawn = "";
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<TimelineSettings>,
    ): Promise<void> {
        const state = this.#stateFor(ev.action.id);
        const before = state.settings;
        state.settings = ev.payload.settings ?? {};
        state.revision++;
        // Turning demo on or off, or changing its SOBT, starts the pretend clock afresh.
        // Editing the list or colours leaves it running so the change can be watched.
        if (
            (before.demo === true) !== (state.settings.demo === true) ||
            demoMinutes(before) !== demoMinutes(state.settings)
        ) {
            state.demo = undefined;
        }
        this.#refreshFeedsFor(ev.action.id);
        this.onCadenceChanged?.();
        await this.render(ev.action);
    }

    /**
     * A key is timed exactly like the dial, down and up, so a button-only deck gets the
     * long press too. Acting on release rather than on press is what makes a hold
     * measurable at all; without it there was no way to clear the acknowledgements
     * without a dial.
     */
    override onKeyDown(ev: KeyDownEvent<TimelineSettings>): void {
        this.#down(ev.action.id);
    }

    override async onKeyUp(ev: KeyUpEvent<TimelineSettings>): Promise<void> {
        await this.#up(ev.action);
    }

    /**
     * In demo the dial scrubs the pretend clock a minute per detent, so a whole departure
     * can be walked through in seconds. Live, it browses the list instead -- sim time is
     * not ours to move.
     */
    override async onDialRotate(ev: DialRotateEvent<TimelineSettings>): Promise<void> {
        const state = this.#stateFor(ev.action.id);
        if (state.settings.demo === true) {
            this.#demoFor(state).offsetMs += ev.payload.ticks * 60_000;
            state.browse = undefined;
        } else {
            const items = parseTimeline(state.settings.items);
            if (items.length > 0) {
                const start = state.browse?.index ?? this.#currentIndex(state, items);
                const index = Math.min(items.length - 1, Math.max(0, start + ev.payload.ticks));
                state.browse = { index, at: Date.now() };
            }
        }
        await this.render(ev.action);
    }

    override onDialDown(ev: DialDownEvent<TimelineSettings>): void {
        this.#down(ev.action.id);
    }

    override async onDialUp(ev: DialUpEvent<TimelineSettings>): Promise<void> {
        await this.#up(ev.action);
    }

    /** Start timing a press, so the release can tell a tap from a hold. */
    #down(id: string): void {
        this.#stateFor(id).pressedAt = performance.now();
    }

    /** Act on release: held long enough is a reset, anything shorter is a tap. */
    async #up(target: TimelineInstance): Promise<void> {
        const state = this.#stateFor(target.id);
        const held = state.pressedAt !== undefined ? performance.now() - state.pressedAt : 0;
        state.pressedAt = undefined;
        await this.#press(target, held >= LONG_PRESS_MS);
    }

    override async onTouchTap(ev: TouchTapEvent<TimelineSettings>): Promise<void> {
        await this.#press(ev.action, false);
    }

    /**
     * Short press: leave browsing, otherwise acknowledge the item that is due, otherwise
     * reload SimBrief (the same gesture the STD clock uses). Long press: clear every
     * acknowledgement, and restart the demo clock from its SOBT.
     */
    async #press(target: TimelineInstance, long: boolean): Promise<void> {
        const state = this.#stateFor(target.id);
        if (long) {
            state.acknowledged.clear();
            state.browse = undefined;
            if (state.settings.demo === true) state.demo = undefined;
        } else if (state.browse) {
            state.browse = undefined;
        } else {
            const clock = this.#clock(state);
            const view =
                clock && timelineView(parseTimeline(state.settings.items), clock.remainingMs, state.acknowledged);
            if (view && view.kind === "due") {
                state.acknowledged.add(view.item.minutes);
            } else if (state.settings.demo !== true) {
                simBriefFeed.refreshNow();
            }
        }
        state.lastDrawn = "";
        await this.render(target);
    }

    async renderAll(): Promise<void> {
        for (const instance of this.actions) {
            await this.render(instance);
        }
    }

    /** Placed timelines count down in seconds, so they always want a one-second tick. */
    nextTickDelayMs(): number | undefined {
        for (const _ of this.actions) return 1000;
        return undefined;
    }

    /**
     * A live timeline reads sim time; a demo one runs on the PC clock.
     *
     * Only once there is an OFP, though. With no SOBT to count down to the dial reads
     * NO OFP whether the bridge is up or not, so a timeline sitting on the deck between
     * flights no longer keeps simclock_bridge.exe running for as long as Stream Deck is
     * open. The bridge comes back on its own when the next OFP lands.
     */
    anyNeedsSimBridge(): boolean {
        if (simBriefFeed.sobt === null) return false;
        for (const instance of this.actions) {
            if (this.#state.get(instance.id)?.settings.demo !== true) return true;
        }
        return false;
    }

    async render(target: TimelineInstance): Promise<void> {
        const state = this.#stateFor(target.id);
        const isDial = target.isDial();
        const lines = this.#lines(state);

        const signature = `${state.revision}|${isDial ? "d" : "k"}|` + lines.map((l) => `${l.text}~${l.color}`).join("|");
        if (signature === state.lastDrawn) return;

        const image = renderLines(state.settings, isDial ? "dial" : "key", lines);
        try {
            if (target.isDial()) {
                await target.setFeedback({ canvas: image });
            } else {
                await target.setImage(image);
            }
            state.lastDrawn = signature;
        } catch (err) {
            streamDeck.logger.warn(`Failed to draw timeline ${target.id}: ${String(err)}`);
        }
    }

    /** SOBT and "now" from SimBrief and the sim, or from the demo clock. */
    #clock(state: InstanceState): { sobtMs: number; remainingMs: number } | null {
        if (state.settings.demo === true) {
            const demo = this.#demoFor(state);
            const sobtMs = demo.startedAt + demoMinutes(state.settings) * 60_000;
            return { sobtMs, remainingMs: sobtMs - (Date.now() + demo.offsetMs) };
        }
        const sobt = simBriefFeed.sobt;
        const now = timeFor("sim");
        if (sobt === null || now === null) return null;
        return { sobtMs: sobt.getTime(), remainingMs: sobt.getTime() - now.getTime() };
    }

    #lines(state: InstanceState): [Line, Line, Line] {
        const s = state.settings;
        const headerColor = resolveColor(s.headerColor, DEFAULTS.headerColor);
        const timeColor = resolveColor(s.timeColor, DEFAULTS.timeColor);
        const dueColor = resolveColor(s.dueColor, DEFAULT_DUE_COLOR);
        const tag = s.demo === true ? "DEMO " : "";
        const items = parseTimeline(s.items);

        const clock = this.#clock(state);
        if (clock === null) {
            const missing = simBriefFeed.sobt === null ? "NO OFP" : "NO SIM";
            return [
                { text: "TIMELINE", color: headerColor },
                { text: missing, color: timeColor },
                { text: NO_TIME, color: timeColor },
            ];
        }

        // A new OFP is a new departure: acknowledgements from the last one no longer apply.
        if (state.ackFor !== clock.sobtMs) {
            state.ackFor = clock.sobtMs;
            state.acknowledged.clear();
        }

        if (state.browse && Date.now() - state.browse.at > BROWSE_TIMEOUT_MS) state.browse = undefined;
        const browsed = state.browse ? items[state.browse.index] : undefined;
        if (state.browse && browsed) {
            const i = state.browse.index;
            const item = browsed;
            const inMs = clock.remainingMs - item.minutes * 60_000;
            return [
                { text: `${dLabel(item.minutes)}  ${i + 1}/${items.length}`, color: headerColor },
                { text: item.label, color: timeColor },
                { text: inMs >= 0 ? `in ${formatChrono(inMs)}` : "PAST", color: headerColor },
            ];
        }

        const toStd = countdown(clock.remainingMs);
        const view = timelineView(items, clock.remainingMs, state.acknowledged);
        switch (view.kind) {
            case "due":
                return [
                    { text: `${tag}${dLabel(view.item.minutes)} DUE`, color: dueColor },
                    { text: view.item.label, color: dueColor },
                    { text: `STD ${toStd}`, color: timeColor },
                ];
            case "next":
                return [
                    { text: `${tag}NEXT ${dLabel(view.item.minutes)}`, color: headerColor },
                    { text: view.item.label, color: timeColor },
                    { text: `in ${formatChrono(view.inMs)}`, color: timeColor },
                ];
            default:
                return [
                    { text: `${tag}TIMELINE`, color: headerColor },
                    { text: "COMPLETE", color: timeColor },
                    { text: `STD ${toStd}`, color: timeColor },
                ];
        }
    }

    /** Index of the item the timeline is on now, where browsing starts from. */
    #currentIndex(state: InstanceState, items: TimelineItem[]): number {
        const clock = this.#clock(state);
        if (!clock) return 0;
        const view = timelineView(items, clock.remainingMs, state.acknowledged);
        if (view.kind === "done") return items.length - 1;
        return Math.max(0, items.indexOf(view.item));
    }

    #demoFor(state: InstanceState): { startedAt: number; offsetMs: number } {
        state.demo ??= { startedAt: Date.now(), offsetMs: 0 };
        return state.demo;
    }

    /**
     * Write the default list into a timeline that has never had one.
     *
     * The property inspector's textarea cannot show a placeholder -- sdpi-textarea has no
     * such property, so the attribute is dropped and an unconfigured timeline presents an
     * empty box with no hint of the format. Seeding the setting with the list the parser
     * already falls back to costs nothing behaviourally and leaves a real, editable example
     * in the panel. Only an absent setting is seeded, so clearing the box stays cleared.
     */
    async #seedItems(target: TimelineInstance, state: InstanceState): Promise<void> {
        if (state.settings.items !== undefined) return;

        state.settings = { ...state.settings, items: DEFAULT_TIMELINE_TEXT };
        try {
            await target.setSettings(state.settings);
        } catch (err) {
            // Not fatal: the parser falls back to the same list, so only the panel looks bare.
            streamDeck.logger.warn(`Could not seed timeline items: ${String(err)}`);
        }
    }

    #refreshFeedsFor(id: string): void {
        if (this.#state.get(id)?.settings.demo !== true) simBriefFeed.refreshNow();
    }

    #stateFor(id: string): InstanceState {
        let state = this.#state.get(id);
        if (!state) {
            state = {
                settings: {},
                revision: 0,
                lastDrawn: "",
                acknowledged: new Set(),
                ackFor: undefined,
                browse: undefined,
                demo: undefined,
                pressedAt: undefined,
            };
            this.#state.set(id, state);
        }
        return state;
    }
}

/** Demo SOBT in minutes from the start of the demo; blank or junk uses the default. */
function demoMinutes(settings: TimelineSettings): number {
    const n = Number(String(settings.demoMinutes ?? "").trim());
    return Number.isFinite(n) && n > 0 && n <= 600 ? n : DEFAULT_DEMO_MINUTES;
}

/** MM:SS to SOBT, or +MM:SS once past it -- the countdown clock's convention. */
function countdown(remainingMs: number): string {
    return remainingMs >= 0 ? formatChrono(remainingMs) : `+${formatChrono(-remainingMs)}`;
}
