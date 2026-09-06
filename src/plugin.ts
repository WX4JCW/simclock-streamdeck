import streamDeck from "@elgato/streamdeck";

import { bridgeProcess } from "./bridge-process.js";
import { ClockAction } from "./clock-action.js";
import { simBriefFeed } from "./simbrief-feed.js";
import { simFeed } from "./sim-feed.js";
import { Ticker } from "./ticker.js";
import type { GlobalSettings } from "./settings.js";

streamDeck.logger.setLevel("info");

const clock = new ClockAction();
streamDeck.actions.registerAction(clock);

// The SimBrief username is plugin-wide: entered once, used by every placed clock.
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
    simBriefFeed.setUsername(ev.settings.simbriefUsername);
});

/**
 * One loop drives every instance on the deck, and also starts and stops the SimConnect
 * bridge so it runs only while a clock that reads sim time is actually placed.
 *
 * The interval is asked for after each pass rather than fixed: a plain HH:MM clock sleeps
 * to the next minute boundary, while a countdown, a sim clock, or a running chronometer
 * asks for a second. Draws that would produce identical pixels are skipped inside the
 * action, so a wake-up is usually cheap.
 */
const ticker = new Ticker(
    async () => {
        if (clock.anyNeedsSimBridge()) {
            bridgeProcess.ensureRunning();
        } else if (bridgeProcess.isRunning) {
            bridgeProcess.stop();
        }
        await clock.renderAll();
    },
    () => clock.nextTickDelayMs(),
    (err) => streamDeck.logger.warn(`Clock tick failed: ${String(err)}`),
);

// Switching Stream Deck pages removes every instance, which drops the loop to a
// minute-long sleep. Coming back must cancel that sleep, or the countdown stays frozen
// until the stale timer happens to fire.
clock.onCadenceChanged = () => ticker.wake();

simFeed.start();
simBriefFeed.start();

await streamDeck.connect();
void streamDeck.settings
    .getGlobalSettings<GlobalSettings>()
    .then((s) => simBriefFeed.setUsername(s.simbriefUsername))
    .catch(() => undefined);

ticker.start();
