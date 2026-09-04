"""
Sim Clock bridge -- serves the Microsoft Flight Simulator clock over localhost HTTP.

Stream Deck plugins cannot call SimConnect, so this process reads the sim's clock and
publishes it on 127.0.0.1:47600. The plugin polls once a second and extrapolates between
samples; nothing here needs to be fast, only truthful.

Time comes from the ABSOLUTE_TIME SimVar: seconds since 0001-01-01 00:00:00 UTC, with no
epoch offset (verified against a live MSFS 2024 read -- 63914595623 == 2026-05-17
06:20:23Z). That single variable is the sim's own UTC, which is what "Sim Zulu" means.

Run:  py -3.12 simclock_bridge.py
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

HOST = "127.0.0.1"
PORT = 47600

# Cadence copied from a known-good SimConnect acquisition loop rather than re-derived.
POLL_INTERVAL_S = 0.5
RECONNECT_WAIT_S = 5.0

# AircraftRequests cache TTL.
#
# A larger value (2000 ms) is the right call when polling *many* SimVars -- that is what
# a bigger acquisition loop needs, and lowering it there starves the message queue. This
# bridge requests exactly ONE variable, and measurement on a live MSFS shows 200 ms
# returns a smoothly advancing value with no dropped reads across 25 consecutive polls.
#
# At 2000 ms, ABSOLUTE_TIME sits frozen for two seconds and then jumps by two: harmless
# for an HH:MM clock, but the countdown shows seconds and visibly ticked in 2 s steps.
REQUEST_CACHE_TTL_MS = 200

# ABSOLUTE_TIME's epoch coincides with datetime's, so no correction is applied.
ABSOLUTE_TIME_EPOCH_OFFSET_S = 0

# Guard rails for the derived time-compression rate.
# Exit when the plugin stops polling. The bridge lives inside the plugin folder, and on
# Windows a child process outlives a force-terminated parent -- an orphan would hold its
# own executable open and block Stream Deck from uninstalling or upgrading the plugin.
# The plugin polls once a second, so silence this long means it is gone.
IDLE_SHUTDOWN_S = 30.0
IDLE_CHECK_INTERVAL_S = 5.0

MIN_RATE, MAX_RATE = 0.1, 128.0
RATE_SMOOTHING = 0.4  # EMA weight for each new observation


class SimClock:
    """Holds the most recent sim clock reading and the observed time-compression rate."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sim_utc: Optional[datetime] = None
        self._sim_utc_at: float = 0.0  # monotonic timestamp of that reading
        self._rate: float = 1.0
        self._connected: bool = False
        # Previous *distinct* raw reading, for deriving the rate.
        self._prev_raw: Optional[float] = None
        self._prev_raw_at: float = 0.0

    def update(self, raw_absolute_time: float) -> None:
        sim_utc = _to_utc(raw_absolute_time)
        if sim_utc is None:
            return

        now = time.monotonic()
        with self._lock:
            changed = self._prev_raw is None or raw_absolute_time != self._prev_raw

            # SimConnect caches ABSOLUTE_TIME for REQUEST_CACHE_TTL_MS, so several
            # consecutive polls return the identical value. Only a *changed* reading
            # carries information -- about the rate, and about where the clock actually
            # is. Re-anchoring on a repeat would reset the extrapolation base to an old
            # value stamped "now", freezing the clock until the cache expires and then
            # jumping by the whole TTL. That is the two-second staircase.
            if not changed:
                self._connected = True
                return

            if self._prev_raw is not None:
                wall_delta = now - self._prev_raw_at
                sim_delta = raw_absolute_time - self._prev_raw
                if wall_delta > 0.05 and sim_delta > 0:
                    observed = sim_delta / wall_delta
                    if MIN_RATE <= observed <= MAX_RATE:
                        self._rate = (
                            RATE_SMOOTHING * observed + (1 - RATE_SMOOTHING) * self._rate
                        )

            self._prev_raw = raw_absolute_time
            self._prev_raw_at = now
            self._sim_utc = sim_utc
            self._sim_utc_at = now
            self._connected = True

    def mark_disconnected(self) -> None:
        with self._lock:
            self._connected = False
            self._sim_utc = None
            self._prev_raw = None
            self._rate = 1.0

    def snapshot(self) -> dict:
        with self._lock:
            if not self._connected or self._sim_utc is None:
                return {
                    "ok": True,
                    "sim_connected": False,
                    "sim_utc_ms": None,
                    "rate": 1.0,
                }
            # Advance the stored reading to now, so a poll landing between SimConnect
            # samples still gets a current value instead of a 2-second-old one.
            advanced = self._sim_utc + timedelta(
                seconds=(time.monotonic() - self._sim_utc_at) * self._rate
            )
            return {
                "ok": True,
                "sim_connected": True,
                "sim_utc_ms": int(advanced.timestamp() * 1000),
                "rate": round(self._rate, 3),
            }


def _to_utc(absolute_time: Optional[float]) -> Optional[datetime]:
    """ABSOLUTE_TIME seconds -> aware UTC datetime; None for absent or implausible values."""
    try:
        if absolute_time is None or absolute_time <= ABSOLUTE_TIME_EPOCH_OFFSET_S:
            return None
        dt = datetime(1, 1, 1, tzinfo=timezone.utc) + timedelta(
            seconds=absolute_time - ABSOLUTE_TIME_EPOCH_OFFSET_S
        )
        return dt if dt.year >= 1900 else None
    except (ValueError, OverflowError, OSError):
        return None


def poll_loop(clock: SimClock, stop: threading.Event) -> None:
    """Connect to MSFS and read ABSOLUTE_TIME until told to stop, reconnecting as needed."""
    while not stop.is_set():
        try:
            from SimConnect import AircraftRequests, SimConnect  # type: ignore[import]
        except ImportError:
            print("SimConnect package missing. Run: pip install SimConnect")
            stop.wait(RECONNECT_WAIT_S)
            continue

        try:
            sm = SimConnect()
            aq = AircraftRequests(sm, _time=REQUEST_CACHE_TTL_MS)
            print(f"Connected to MSFS. Serving sim clock on http://{HOST}:{PORT}/time")
        except Exception as exc:  # sim not running, or SimConnect refused
            clock.mark_disconnected()
            print(f"Waiting for MSFS ({exc.__class__.__name__}).")
            stop.wait(RECONNECT_WAIT_S)
            continue

        try:
            while not stop.is_set():
                value = aq.get("ABSOLUTE_TIME")
                if value is None:
                    clock.mark_disconnected()
                else:
                    clock.update(float(value))
                stop.wait(POLL_INTERVAL_S)
        except Exception as exc:
            print(f"Lost MSFS connection ({exc.__class__.__name__}). Reconnecting.")
        finally:
            clock.mark_disconnected()
            try:
                sm.exit()
            except Exception:
                pass
            stop.wait(RECONNECT_WAIT_S)


def make_handler(clock: SimClock, last_request: list[float]):
    class Handler(BaseHTTPRequestHandler):
        # Silence per-request logging; the plugin polls once a second forever.
        def log_message(self, *args) -> None:
            pass

        def do_GET(self) -> None:
            last_request[0] = time.monotonic()
            if self.path.split("?")[0] != "/time":
                self.send_error(404)
                return
            body = json.dumps(clock.snapshot()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def idle_watchdog(server: ThreadingHTTPServer, last_request: list[float],
                  stop: threading.Event) -> None:
    """Shut down once the plugin stops polling, so we can never be orphaned."""
    while not stop.wait(IDLE_CHECK_INTERVAL_S):
        if time.monotonic() - last_request[0] > IDLE_SHUTDOWN_S:
            print(f"No requests for {IDLE_SHUTDOWN_S:.0f}s -- plugin gone. Exiting.")
            stop.set()
            threading.Thread(target=server.shutdown, daemon=True).start()
            return


def main() -> None:
    clock = SimClock()
    stop = threading.Event()
    # Grace period: don't exit before the plugin has had a chance to make its first call.
    last_request = [time.monotonic()]

    poller = threading.Thread(target=poll_loop, args=(clock, stop), daemon=True)
    poller.start()

    try:
        server = ThreadingHTTPServer((HOST, PORT), make_handler(clock, last_request))
    except OSError as exc:
        # Another bridge already owns the port and is serving the same data, so this
        # instance has nothing to add. Exit cleanly rather than dying with a traceback.
        print(f"Port {PORT} already in use -- another bridge is running. Exiting. ({exc})")
        stop.set()
        return
    threading.Thread(
        target=idle_watchdog, args=(server, last_request, stop), daemon=True
    ).start()
    print(f"Sim Clock bridge listening on http://{HOST}:{PORT}/time  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        stop.set()
        server.shutdown()


if __name__ == "__main__":
    main()
