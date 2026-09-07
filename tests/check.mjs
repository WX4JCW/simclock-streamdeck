/**
 * Verifies the pure display logic: time formatting, the chronometer state machine,
 * and SVG rendering. No Stream Deck or MSFS needed.
 * Run: node tests/check.mjs   (after `npm run build:test`)
 */
import assert from "node:assert/strict";

import { Chrono } from "../.testbuild/chrono.js";
import { formatChrono, formatCountdown, formatHHMM, NO_TIME } from "../.testbuild/format.js";
import { parseEpochSeconds } from "../.testbuild/ofp.js";
import { colorForRemaining, readThresholds } from "../.testbuild/thresholds.js";
import { estimateTextWidth, fitFontSize, renderClock } from "../.testbuild/render.js";
import { msUntilNextMinute } from "../.testbuild/schedule.js";
import { Ticker } from "../.testbuild/ticker.js";
import {
    defaultHeader,
    LATE_LABEL,
    needsSimBrief,
    needsSimBridge,
    resolveColor,
    resolveFont,
    resolveHeader,
    resolveSource,
} from "../.testbuild/settings.js";

let passed = 0;
const check = (name, fn) => {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
};

console.log("\ntime formatting");
// 2026-09-03T18:07:00Z -- UTC minutes/hours must come from the UTC getters, not local.
const d = new Date(Date.UTC(2026, 8, 3, 18, 7, 0));
check("zulu reads UTC", () => assert.equal(formatHHMM(d, "zulu"), "18:07"));
check("sim reads UTC", () => assert.equal(formatHHMM(d, "sim"), "18:07"));
check("pc reads local", () => {
    const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    assert.equal(formatHHMM(d, "pc"), expected);
});
check("midnight pads to 00:00", () =>
    assert.equal(formatHHMM(new Date(Date.UTC(2026, 0, 1, 0, 0)), "zulu"), "00:00"));
check("noon stays 24-hour", () =>
    assert.equal(formatHHMM(new Date(Date.UTC(2026, 0, 1, 12, 0)), "zulu"), "12:00"));
check("23:59 does not roll", () =>
    assert.equal(formatHHMM(new Date(Date.UTC(2026, 0, 1, 23, 59)), "zulu"), "23:59"));
check("null sim time shows placeholder, never real time", () =>
    assert.equal(formatHHMM(null, "sim"), NO_TIME));

console.log("\nchronometer readout");
check("zero", () => assert.equal(formatChrono(0), "00:00"));
check("seconds", () => assert.equal(formatChrono(45_000), "00:45"));
check("minutes", () => assert.equal(formatChrono(9 * 60_000 + 5_000), "09:05"));
check("rolls to hours past 60 min", () => assert.equal(formatChrono(3_661_000), "01:01"));
check("negative clamps to zero", () => assert.equal(formatChrono(-5000), "00:00"));

console.log("\nchronometer state machine");
check("starts idle and inactive", () => {
    const c = new Chrono();
    assert.equal(c.state, "idle");
    assert.equal(c.isActive(), false);
});
check("rotate sets whole minutes", () => {
    const c = new Chrono();
    c.rotate(3);
    assert.equal(c.setMs, 180_000);
    assert.equal(c.isActive(), true, "a dialled-in value should take over the display");
});
check("rotate cannot go negative", () => {
    const c = new Chrono();
    c.rotate(-5);
    assert.equal(c.setMs, 0);
});
check("rotate is ignored while running, so a knock cannot rewrite the target", () => {
    const c = new Chrono();
    c.rotate(5);
    c.toggle();
    c.rotate(10);
    assert.equal(c.setMs, 300_000);
});
check("toggle runs then stops", () => {
    const c = new Chrono();
    c.toggle();
    assert.equal(c.state, "running");
    c.toggle();
    assert.equal(c.state, "stopped");
});
check("reset returns to the clock", () => {
    const c = new Chrono();
    c.rotate(5);
    c.toggle();
    c.reset();
    assert.equal(c.state, "idle");
    assert.equal(c.setMs, 0);
    assert.equal(c.isActive(), false);
});
check("counts down from the dialled target", () => {
    const c = new Chrono();
    c.rotate(2);
    c.toggle();
    assert.ok(c.displayMs() <= 120_000 && c.displayMs() > 119_000);
});

console.log("\nsettings resolution");
check("defaults to pc", () => assert.equal(resolveSource({}), "pc"));
check("rejects an unknown source", () =>
    assert.equal(resolveSource({ source: "garbage" }), "pc"));
check("header defaults per source", () => {
    assert.equal(resolveHeader({}, defaultHeader("pc")), "LOCAL");
    assert.equal(resolveHeader({}, defaultHeader("zulu")), "ZULU");
    assert.equal(resolveHeader({}, defaultHeader("sim")), "SIM");
});
check("custom header wins", () =>
    assert.equal(resolveHeader({ header: "KJFK" }, defaultHeader("zulu")), "KJFK"));
check("blank header falls back", () =>
    assert.equal(resolveHeader({ header: "   " }, defaultHeader("zulu")), "ZULU"));
check("font defaults to Segoe UI", () => assert.equal(resolveFont({}), "Segoe UI"));
check("custom font wins", () =>
    assert.equal(resolveFont({ fontFamily: "Consolas" }), "Consolas"));
check("invalid colour falls back rather than emitting bad SVG", () => {
    assert.equal(resolveColor("red; }", "#FFFFFF"), "#FFFFFF");
    assert.equal(resolveColor("#ABC", "#FFFFFF"), "#ABC");
    assert.equal(resolveColor("#a1b2c3", "#FFFFFF"), "#a1b2c3");
});

console.log("\nrendering");
const decode = (uri) => {
    assert.ok(uri.startsWith("data:image/svg+xml;base64,"));
    return Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
};
check("key renders at 144x144 with both lines", () => {
    const svg = decode(renderClock({}, "key", "ZULU", "18:07"));
    assert.match(svg, /width="144" height="144"/);
    assert.ok(svg.includes(">ZULU<") && svg.includes(">18:07<"));
});
check("dial renders at 200x100", () => {
    const svg = decode(renderClock({}, "dial", "SIM", "--:--"));
    assert.match(svg, /width="200" height="100"/);
});
check("both lines are centre-anchored", () => {
    const svg = decode(renderClock({}, "key", "A", "B"));
    assert.equal((svg.match(/text-anchor="middle"/g) ?? []).length, 2);
});
check("user text is XML-escaped", () => {
    const svg = decode(renderClock({ fontFamily: 'x" onload="evil' }, "key", "A&B<C>", "00:00"));
    assert.ok(svg.includes("A&amp;B&lt;C&gt;"));
    assert.ok(!svg.includes('onload="evil'), "quotes in the font name must not break out");
});
check("colours are applied", () => {
    const svg = decode(
        renderClock({ bgColor: "#123456", headerColor: "#abcdef", timeColor: "#fedcba" }, "key", "H", "V"),
    );
    assert.ok(svg.includes("#123456") && svg.includes("#abcdef") && svg.includes("#fedcba"));
});


console.log("\ntick scheduling");
const atSecond = (s, ms = 0) => Date.UTC(2026, 8, 3, 12, 30, s, ms);
check("start of a minute waits a full minute", () =>
    assert.equal(msUntilNextMinute(atSecond(0)), 60_020));
check("mid-minute waits the remainder", () =>
    assert.equal(msUntilNextMinute(atSecond(30)), 30_020));
check("last second waits under a second", () =>
    assert.equal(msUntilNextMinute(atSecond(59)), 1_020));
check("just before the boundary stays positive, never zero", () => {
    const d = msUntilNextMinute(atSecond(59, 999));
    assert.ok(d > 0, `delay must stay positive, got ${d}`);
    assert.equal(d, 21);
});
check("never schedules beyond a minute plus the guard", () => {
    for (let s = 0; s < 60; s++) {
        for (const ms of [0, 1, 500, 999]) {
            const d = msUntilNextMinute(atSecond(s, ms));
            assert.ok(d > 0 && d <= 60_020, `out of range at ${s}.${ms}: ${d}`);
        }
    }
});

console.log("\nSimBrief OFP parsing");
check("epoch seconds as a number", () =>
    assert.equal(parseEpochSeconds(1788479054)?.toISOString(), "2026-09-03T23:44:14.000Z"));
check("epoch seconds as a string", () =>
    assert.equal(parseEpochSeconds("1788479054")?.toISOString(), "2026-09-03T23:44:14.000Z"));
check("missing or empty is null, not 1970", () => {
    assert.equal(parseEpochSeconds(undefined), null);
    assert.equal(parseEpochSeconds(null), null);
    assert.equal(parseEpochSeconds(""), null);
    assert.equal(parseEpochSeconds(0), null);
});
check("garbage is null", () => {
    assert.equal(parseEpochSeconds("not-a-time"), null);
    assert.equal(parseEpochSeconds(NaN), null);
    assert.equal(parseEpochSeconds(-500), null);
});
check("absurd years rejected rather than rendered as a clock", () => {
    assert.equal(parseEpochSeconds(1), null);
    assert.equal(parseEpochSeconds(99_999_999_999), null);
});

console.log("\ncountdown to STD");
const std = new Date(Date.UTC(2026, 8, 3, 20, 0, 0));
check("counts down in MM:SS under an hour", () =>
    assert.deepEqual(formatCountdown(std, new Date(Date.UTC(2026, 8, 3, 19, 15, 30))),
        { text: "44:30", late: false }));
check("rolls to HH:MM beyond an hour", () =>
    assert.deepEqual(formatCountdown(std, new Date(Date.UTC(2026, 8, 3, 17, 30, 0))),
        { text: "02:30", late: false }));
check("exactly on time is not late", () =>
    assert.deepEqual(formatCountdown(std, std), { text: "00:00", late: false }));
check("past STD counts up with a + and flags late", () =>
    assert.deepEqual(formatCountdown(std, new Date(Date.UTC(2026, 8, 3, 20, 12, 34))),
        { text: "+12:34", late: true }));
check("no OFP shows the placeholder, never a number", () => {
    assert.deepEqual(formatCountdown(null, std), { text: NO_TIME, late: false });
    assert.deepEqual(formatCountdown(std, null), { text: NO_TIME, late: false });
});

console.log("\nsource routing");
check("new sources are accepted", () => {
    assert.equal(resolveSource({ source: "std" }), "std");
    assert.equal(resolveSource({ source: "tostd" }), "tostd");
});
check("default headers", () => {
    assert.equal(defaultHeader("std"), "STD");
    assert.equal(defaultHeader("tostd"), "TO STD");
});
check("a typed header survives the LATE flip", () =>
    assert.equal(resolveHeader({ header: "PUSH" }, LATE_LABEL), "PUSH"));
check("auto header takes the LATE fallback", () =>
    assert.equal(resolveHeader({}, LATE_LABEL), "LATE"));
check("only sim-reading sources need the bridge", () => {
    assert.equal(needsSimBridge("sim"), true);
    assert.equal(needsSimBridge("tostd"), true);
    assert.equal(needsSimBridge("std"), false);
    assert.equal(needsSimBridge("pc"), false);
    assert.equal(needsSimBridge("zulu"), false);
});
check("only OFP-reading sources need SimBrief", () => {
    assert.equal(needsSimBrief("std"), true);
    assert.equal(needsSimBrief("tostd"), true);
    assert.equal(needsSimBrief("sim"), false);
    assert.equal(needsSimBrief("pc"), false);
});
check("STD renders as UTC, like the other non-pc sources", () =>
    assert.equal(formatHHMM(std, "std"), "20:00"));

console.log("\ncountdown colour thresholds");
const BASE = "#00C853";
const T = { warn1Min: "10", warn1Color: "#FFD400", warn2Min: "5", warn2Color: "#FF8A00",
            warn3Min: "0", warn3Color: "#FF3B30" };
const at = (min) => colorForRemaining(min * 60_000, readThresholds(T), BASE);
check("well clear uses the base colour", () => assert.equal(at(30), BASE));
check("just above the top threshold stays base", () => assert.equal(at(10.5), BASE));
check("exactly on a threshold fires it", () => assert.equal(at(10), "#FFD400"));
check("between thresholds takes the lower band", () => assert.equal(at(7), "#FFD400"));
check("inside five minutes", () => assert.equal(at(3), "#FF8A00"));
check("at departure", () => assert.equal(at(0), "#FF3B30"));
check("after departure stays at the lowest band", () => assert.equal(at(-15), "#FF3B30"));
check("a blank row is switched off", () => {
    const partial = { ...T, warn2Min: "", warn3Min: "  " };
    assert.equal(colorForRemaining(3 * 60_000, readThresholds(partial), BASE), "#FFD400");
    assert.equal(colorForRemaining(-5 * 60_000, readThresholds(partial), BASE), "#FFD400");
});
check("no thresholds at all leaves the base colour", () =>
    assert.equal(colorForRemaining(0, readThresholds({}), BASE), BASE));
check("junk minutes are ignored, not treated as zero", () =>
    assert.equal(colorForRemaining(60 * 60_000, readThresholds({ warn1Min: "abc",
        warn1Color: "#FF0000" }), BASE), BASE));
check("rows are ordered by minutes regardless of entry order", () => {
    const jumbled = { warn1Min: "0", warn1Color: "#FF3B30", warn2Min: "10",
                      warn2Color: "#FFD400", warn3Min: "5", warn3Color: "#FF8A00" };
    assert.equal(colorForRemaining(7 * 60_000, readThresholds(jumbled), BASE), "#FFD400");
    assert.equal(colorForRemaining(2 * 60_000, readThresholds(jumbled), BASE), "#FF8A00");
});
check("an override recolours only the time, not the header", () => {
    const svg = Buffer.from(
        renderClock({ headerColor: "#111111", timeColor: "#222222" }, "key", "TO STD", "04:30",
            "#FF3B30").slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
    assert.ok(svg.includes("#FF3B30"), "override colour must be applied");
    assert.ok(svg.includes("#111111"), "header colour must survive");
    assert.ok(!svg.includes("#222222"), "configured time colour must be replaced");
});

console.log("\nthreshold minute entry");
const mins = (v) => readThresholds({ warn1Min: v, warn1Color: "#FFD400" });
check("plain number", () => assert.equal(mins("10")[0]?.minutes, 10));
check("clock notation is accepted, not silently dropped", () =>
    assert.equal(mins("10:00")[0]?.minutes, 10));
check("clock notation with seconds", () => assert.equal(mins("1:30")[0]?.minutes, 1.5));
check("sub-minute via clock notation", () => assert.equal(mins("0:30")[0]?.minutes, 0.5));
check("decimals still work", () => assert.equal(mins("2.5")[0]?.minutes, 2.5));
check("blank is off", () => assert.equal(mins("").length, 0));
check("junk is still rejected, not treated as zero", () => {
    assert.equal(mins("abc").length, 0);
    assert.equal(mins("10:99").length, 0);
});
check("10:00 now colours a 5-minute countdown", () =>
    assert.equal(colorForRemaining(5 * 60_000, mins("10:00"), "#00C853"), "#FFD400"));

console.log("\nthreshold colour defaults");
check("minutes set but colour never touched uses that row's default, not white", () => {
    const t = readThresholds({ warn1Min: "8", warn2Min: "5", warn3Min: "1" });
    assert.equal(colorForRemaining(6 * 60_000, t, "#00C853"), "#FFD400");
    assert.equal(colorForRemaining(3 * 60_000, t, "#00C853"), "#FF8A00");
    assert.equal(colorForRemaining(0.5 * 60_000, t, "#00C853"), "#FF3B30");
});
check("no row ever falls back to white", () => {
    for (const c of readThresholds({ warn1Min: "8", warn2Min: "5", warn3Min: "1" })) {
        assert.notEqual(c.color.toUpperCase(), "#FFFFFF");
    }
});
check("an explicitly chosen colour still wins over the default", () =>
    assert.equal(readThresholds({ warn1Min: "8", warn1Color: "#00AAFF" })[0]?.color, "#00AAFF"));

console.log("\nticker wake (page-switch regression)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
    // The bug: after the last instance disappears the loop parks on a long sleep, and
    // nothing shortens it when instances come back. Model that with a delay provider
    // that returns a long interval, then assert wake() runs anyway.
    let runs = 0;
    const t = new Ticker(async () => { runs++; }, () => 60_000);
    t.start();
    await sleep(30);
    assert.equal(runs, 1, "start should run immediately");

    await sleep(60);
    assert.equal(runs, 1, "should then be parked on the long sleep");

    t.wake();
    await sleep(30);
    assert.equal(runs, 2, "wake must cancel the pending sleep and run now");
    t.stop();
    passed++;
    console.log("  ok  wake cancels a long pending sleep");
})();

await (async () => {
    let runs = 0;
    const t = new Ticker(async () => { runs++; }, () => 20);
    t.start();
    await sleep(120);
    t.stop();
    const after = runs;
    await sleep(80);
    assert.ok(runs > 2, "short delays should keep cycling");
    assert.equal(runs, after, "stop must end the loop");
    passed++;
    console.log("  ok  stop ends the loop");
})();

await (async () => {
    // A failing cycle must not kill the loop -- a transient Stream Deck write error
    // should never leave every clock frozen.
    let runs = 0, errors = 0;
    const t = new Ticker(
        async () => { runs++; throw new Error("boom"); },
        () => 20,
        () => { errors++; },
    );
    t.start();
    await sleep(120);
    t.stop();
    assert.ok(runs > 2, `a throwing cycle must keep rescheduling, got ${runs}`);
    assert.equal(errors, runs, "every failure should be reported");
    passed++;
    console.log("  ok  a throwing cycle keeps the loop alive");
})();

await (async () => {
    // wake() during a cycle is ignored on purpose; the cycle's own reschedule sees the
    // new state. Assert it does not stack a second concurrent run.
    let concurrent = 0, maxConcurrent = 0;
    const t = new Ticker(
        async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
                      await sleep(40); concurrent--; },
        () => 500,
    );
    t.start();
    await sleep(20);
    t.wake(); t.wake(); t.wake();
    await sleep(60);
    t.stop();
    assert.equal(maxConcurrent, 1, "wake must never start an overlapping cycle");
    passed++;
    console.log("  ok  wake during a cycle does not stack runs");
})();

console.log("\nfit text to key width");
const KEY_W = 144, TIME_SIZE = 46, HDR_SIZE = 22, SAFE = 144 * 0.92;
check("a normal HH:MM keeps its full size", () =>
    assert.equal(fitFontSize("14:32", TIME_SIZE, KEY_W), TIME_SIZE));
check("the placeholder keeps its full size", () =>
    assert.equal(fitFontSize("--:--", TIME_SIZE, KEY_W), TIME_SIZE));
check("a late countdown shrinks rather than clipping", () => {
    const fitted = fitFontSize("+12:34", TIME_SIZE, KEY_W);
    assert.ok(fitted < TIME_SIZE, `expected a smaller size, got ${fitted}`);
    assert.ok(estimateTextWidth("+12:34", fitted) <= SAFE,
        "fitted text must sit inside the safe width");
});
check("every late value from +00:00 to +99:59 fits", () => {
    for (const v of ["+00:00", "+09:05", "+45:30", "+99:59", "+01:01"]) {
        const f = fitFontSize(v, TIME_SIZE, KEY_W);
        assert.ok(estimateTextWidth(v, f) <= SAFE, `${v} overflows at size ${f}`);
    }
});
check("a full-length custom header fits, letter-spacing included", () => {
    const spacing = 1.5;
    const f = fitFontSize("DEPARTURES", HDR_SIZE, KEY_W, spacing);
    assert.ok(f < HDR_SIZE, "a ten-character header must shrink");
    assert.ok(estimateTextWidth("DEPARTURES", f, spacing) <= SAFE,
        "fitted header must sit inside the safe width");
});
check("short headers are untouched", () => {
    for (const h of ["LOCAL", "ZULU", "SIM", "STD", "TO STD", "LATE", "CHR"]) {
        assert.equal(fitFontSize(h, HDR_SIZE, KEY_W, 1.5), HDR_SIZE, `${h} should not shrink`);
    }
});
check("the dial has room the key does not", () => {
    assert.equal(fitFontSize("+12:34", 42, 200), 42, "200px dial should fit six characters");
});
check("never returns a size below 1", () =>
    assert.ok(fitFontSize("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", 46, 10) >= 1));
check("the rendered SVG carries the reduced size", () => {
    const decode = (uri) => Buffer.from(
        uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
    const late = decode(renderClock({}, "key", "LATE", "+12:34"));
    const normal = decode(renderClock({}, "key", "STD", "14:32"));
    assert.match(normal, /font-size="46"/);
    assert.ok(!/font-size="46"[^>]*>\+12:34/.test(late), "late value must not render at 46");
});

console.log(`\n${passed} checks passed\n`);
