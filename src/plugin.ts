import streamDeck from "@elgato/streamdeck";

import { bridgeProcess } from "./bridge-process.js";
import { ClockAction } from "./clock-action.js";
import { simBriefFeed } from "./simbrief-feed.js";
import { simFeed } from "./sim-feed.js";
import type { GlobalSettings } from "./settings.js";

streamDeck.logger.setLevel("info");

const clock = new ClockAction();
streamDeck.actions.registerAction(clock);

// The SimBrief username is plugin-wide: entered once, used by every placed clock.
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
    simBriefFeed.setUsername(ev.settings.simbriefUsername);
});

simFeed.start();
simBriefFeed.start();

await streamDeck.connect();
void streamDeck.settings
    .getGlobalSettings<GlobalSettings>()
    .then((s) => simBriefFeed.setUsername(s.simbriefUsername))
    .catch(() => undefined);

/**
 * One self-scheduling ticker for every instance on the deck.
 *
 * The delay is asked for after each pass rather than fixed: a plain HH:MM clock only
 * changes on the minute, so we sleep until the next boundary instead of waking every
 * second. A running chronometer, a sim clock, or the countdown asks for 1 Hz. Draws that
 * would produce identical pixels are skipped inside the action, so a wake-up is cheap.
 *
 * The same pass starts and stops the SimConnect bridge, so it runs only while a clock
 * that reads sim time is actually on the deck.
 */
async function tick(): Promise<void> {
    try {
        if (clock.anyNeedsSimBridge()) {
            bridgeProcess.ensureRunning();
        } else if (bridgeProcess.isRunning) {
            bridgeProcess.stop();
        }
        await clock.renderAll();
    } catch (err) {
        streamDeck.logger.warn(`Clock tick failed: ${String(err)}`);
    }
    setTimeout(() => void tick(), clock.nextTickDelayMs());
}

void tick();
