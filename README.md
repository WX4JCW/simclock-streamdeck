# Sim Clock

A Stream Deck plugin showing **PC time**, **real Zulu (UTC)**, or **sim Zulu** — the clock
inside Microsoft Flight Simulator — as two centered lines:

```
HEADER
HH:MM
```

Works on keys and on Stream Deck + dials. One action: place it as many times as you like
and set each instance's time source independently.

## Install

```
npm install
npm run build
streamdeck link com.acms.simclock.sdPlugin
```

Developer mode must be on (`streamdeck dev`) and **Stream Deck must be restarted** for it
to take effect. After that, `streamdeck restart com.acms.simclock` reloads the plugin
without restarting Stream Deck.

To produce a distributable installer:

```
npm run pack
```

That writes `dist/com.acms.simclock.streamDeckPlugin` — a plain ZIP containing the
`.sdPlugin` folder at its root, which installs on double-click.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Time Source | PC Time | PC Time / Zulu / Sim Zulu / STD / Countdown to STD |
| Header | auto | Blank shows `LOCAL` / `ZULU` / `SIM`; type anything else, e.g. `KJFK` |
| Font | Segoe UI | Any font family installed on this PC |
| Header Color | `#9AA0A6` | |
| Time Color | `#FFFFFF` | |
| Background | `#000000` | |
| SimBrief User | _(blank)_ | Global — entered once, shared by every clock |

A very wide font can overflow a key — text cannot be measured from Node, so sizes are
fixed with headroom rather than auto-fitted. Pick a condensed face if it clips.

## Sim Zulu

Stream Deck plugins are sandboxed and cannot call SimConnect, so a small bridge process
does it. **You don't start it** — the plugin spawns `bridge/simclock_bridge.exe` when a
clock that needs sim time is placed, and stops it when the last one goes away.

To rebuild that executable after changing the Python:

```
npm run build:bridge
```

It reads the `ABSOLUTE_TIME` SimVar — seconds since `0001-01-01 00:00:00 UTC`, no epoch
offset — and serves it on `http://127.0.0.1:47600/time`. The plugin polls once a second.

Two details that matter:

- **The SimConnect request cache TTL is 2000 ms and must not be lowered.** At `_time=0`
  the SDK drains the message queue and every read returns `None`. The plugin absorbs that
  staleness by anchoring on each sample and advancing from its own monotonic clock.
- **Time compression is handled.** The bridge derives the sim's rate from consecutive
  *changed* readings against wall clock, so 4x cruise doesn't make the display jump each
  time a sample lands.

When the bridge is down or MSFS isn't running, Sim Zulu shows `--:--`. It never falls back
to real time — a wrong number under a `SIM` header is worse than no number.

Sim Zulu is the simulator's own UTC. It diverges from real Zulu as soon as you set a
departure time or compress time; that's the point of having both.

## SimBrief

`STD` shows scheduled off-block from your OFP; `Countdown to STD` shows that time minus
sim Zulu, so it tracks time compression. Past STD it counts up as `+MM:SS` and the auto
header changes to `LATE` — a header you typed yourself is always kept.

SOBT comes from `times/sched_out`, the same field Datalink Pro treats as authoritative.
`sched_off` is takeoff and `sched_in` is arrival; neither is the departure time.

Enter your SimBrief username once in any clock's Property Inspector. Your SimBrief profile
must have **publicly visible** enabled (Account → Privacy) or the API returns nothing.
No password is ever used.

The OFP is polled every 5 minutes — it only changes when you regenerate it, and hammering
SimBrief's API risks a rate limit. Placing or reconfiguring a SimBrief clock pulls a fresh
one immediately, rate-limited to once every 30 seconds.

## Chronometer (dials)

On a Stream Deck + dial:

| Input | Action |
|---|---|
| Rotate | Set the target, one minute per detent (only while idle) |
| Press | Start / stop |
| Long press (0.6 s) | Reset, returning to the clock |
| Touch | Start / stop |

Set a target and it counts down; start from zero and it counts up. While active the
chronometer takes over the same two lines — `CHR` over `MM:SS`. Rotation is ignored while
running so a knock can't rewrite the target mid-timing.

## Tests

```
npm test
```

54 checks covering time formatting, the chronometer state machine, settings fallbacks,
SVG rendering including XML escaping of user input, tick-boundary scheduling,
OFP epoch parsing, and the countdown/late transition.
No Stream Deck or MSFS required.

## Drawing cost

A clock showing `HH:MM` changes once a minute, so it is drawn once a minute -- not sixty
times. Three things keep it cheap:

- **Settings are cached** from `willAppear` / `didReceiveSettings`. The tick never asks
  Stream Deck for them, so the common path costs no IPC at all.
- **Identical draws are skipped.** Each instance remembers a signature of what it last
  sent; an unchanged one is never transmitted.
- **The ticker schedules itself.** With only real-time clocks placed it sleeps to the next
  minute boundary. It drops to 1 Hz when a chronometer is running, or when a Sim Zulu
  clock is placed -- time compression makes sim minutes elapse faster than real ones, so
  real minute boundaries would miss them.

With three clocks placed this is roughly three Stream Deck messages a minute rather than
three hundred and sixty.

## Layout

```
src/                    plugin source (TypeScript)
  plugin.ts             entry point; one self-scheduling ticker drives every instance
  clock-action.ts       the action: events, chronometer wiring, drawing
  render.ts             two-line SVG
  format.ts             HH:MM and MM:SS formatting (pure, tested)
  settings.ts           settings resolution and validation (pure, tested)
  schedule.ts           minute-boundary tick math (pure, tested)
  ofp.ts                SimBrief epoch parsing (pure, tested)
  simbrief-feed.ts      polls the OFP for scheduled off-block
  bridge-process.ts     starts/stops the bridge exe on demand
  chrono.ts             chronometer state machine (pure, tested)
  sim-feed.ts           polls the bridge, extrapolates between samples
  time-source.ts        maps a source to a Date
bridge/                 Python SimConnect bridge
tools/make_icons.py     regenerates the plugin PNG icons
com.acms.simclock.sdPlugin/   the plugin itself (manifest, UI, images, built bin/)
```
