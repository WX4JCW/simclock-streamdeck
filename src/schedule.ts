/** Land just after the boundary rather than racing it. */
const BOUNDARY_GUARD_MS = 20;
const MINUTE_MS = 60_000;

/**
 * Milliseconds until just after the next minute boundary.
 * Minute boundaries are shared by every time zone, so this is correct whether the
 * instance displays local or UTC.
 */
export function msUntilNextMinute(nowMs: number): number {
    return MINUTE_MS - (nowMs % MINUTE_MS) + BOUNDARY_GUARD_MS;
}
