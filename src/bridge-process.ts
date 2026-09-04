import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import streamDeck from "@elgato/streamdeck";

/**
 * Runs the SimConnect bridge as a child process so the user never has to start one.
 *
 * It is spawned when a clock that needs sim time is placed, and stopped when the last
 * one goes away.
 *
 * The executable is copied to the temp directory and run from THERE, never from the
 * plugin folder. Windows refuses to delete or overwrite a running .exe, so a bridge
 * running in place would lock the very folder Stream Deck has to replace during an
 * upgrade -- and there is no way out of that from inside: installing a .streamDeckPlugin
 * requires Stream Deck to be running, which is exactly when the plugin has the bridge
 * running. The SDK exposes no pre-uninstall or shutdown event to hook either. Running
 * from a copy leaves an inert file in the plugin folder and sidesteps all of it.
 */
const EXE_NAME = "simclock_bridge.exe";

/** Floor between spawn attempts, so a bridge that exits at once cannot be respawned
 *  once per tick forever -- e.g. when another process already holds the port. */
const MIN_SPAWN_INTERVAL_MS = 10_000;

/** bin/plugin.js -> <plugin root>/bridge/simclock_bridge.exe */
const SOURCE_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "bridge", EXE_NAME);
const RUN_DIR = join(tmpdir(), "acms-simclock");
const RUN_PATH = join(RUN_DIR, EXE_NAME);

class BridgeProcess {
    #child: ChildProcess | undefined;
    #missingLogged = false;
    #lastSpawnAt = 0;

    get isRunning(): boolean {
        return this.#child !== undefined && this.#child.exitCode === null;
    }

    /** Start the bridge if it isn't already up. Safe to call on every tick. */
    ensureRunning(): void {
        if (this.isRunning) return;
        if (performance.now() - this.#lastSpawnAt < MIN_SPAWN_INTERVAL_MS) return;

        const exe = this.#stagedExecutable();
        if (exe === null) return;

        this.#lastSpawnAt = performance.now();
        try {
            const child = spawn(exe, [], {
                stdio: "ignore",
                windowsHide: true,
                detached: false,
                // Critical: a child inherits our working directory, which Stream Deck
                // sets to the plugin folder -- and Windows refuses to rename a directory
                // that is any running process's current directory. Leaving this unset
                // made the bridge block every plugin upgrade, even after the executable
                // itself was moved out to temp.
                cwd: RUN_DIR,
            });
            child.on("exit", (code) => {
                if (this.#child === child) this.#child = undefined;
                streamDeck.logger.info(`Sim bridge exited (${code ?? "signal"}).`);
            });
            child.on("error", (err) => {
                if (this.#child === child) this.#child = undefined;
                streamDeck.logger.warn(`Sim bridge failed to start: ${String(err)}`);
            });
            this.#child = child;
            streamDeck.logger.info(`Sim bridge started from ${exe}`);
        } catch (err) {
            streamDeck.logger.warn(`Sim bridge failed to start: ${String(err)}`);
        }
    }

    stop(): void {
        if (!this.#child) return;
        const child = this.#child;
        this.#child = undefined;
        try {
            child.kill();
        } catch (err) {
            streamDeck.logger.warn(`Sim bridge failed to stop: ${String(err)}`);
        }
    }

    /**
     * Path to run from: the temp copy, refreshed when the shipped one differs.
     * Falls back to running in place if the copy fails -- a locked folder is a much
     * smaller problem than a sim clock that never works.
     */
    #stagedExecutable(): string | null {
        if (!existsSync(SOURCE_PATH)) {
            if (!this.#missingLogged) {
                streamDeck.logger.warn(`Bridge executable not found at ${SOURCE_PATH}`);
                this.#missingLogged = true;
            }
            return null;
        }

        try {
            if (this.#needsCopy()) {
                mkdirSync(RUN_DIR, { recursive: true });
                copyFileSync(SOURCE_PATH, RUN_PATH);
                streamDeck.logger.info(`Staged bridge to ${RUN_PATH}`);
            }
            return RUN_PATH;
        } catch (err) {
            // Most likely the previous copy is still running and holds the file. That
            // copy is what we want anyway, so use it when it exists.
            if (existsSync(RUN_PATH)) return RUN_PATH;
            streamDeck.logger.warn(`Could not stage bridge, running in place: ${String(err)}`);
            return SOURCE_PATH;
        }
    }

    /** Copy when absent, or when the shipped executable differs from the staged one. */
    #needsCopy(): boolean {
        if (!existsSync(RUN_PATH)) return true;
        try {
            const src = statSync(SOURCE_PATH);
            const dst = statSync(RUN_PATH);
            return src.size !== dst.size || src.mtimeMs > dst.mtimeMs;
        } catch {
            return true;
        }
    }
}

export const bridgeProcess = new BridgeProcess();

// The bridge is our child; never leave one running after Stream Deck unloads the plugin.
for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => bridgeProcess.stop());
}
