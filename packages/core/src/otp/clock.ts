/** Skew above this threshold is recorded and shown to the user (spec §8). */
export const CLOCK_OFFSET_THRESHOLD_SEC = 30;

/** Compares the server's `Date` header with the request midpoint. Returns the offset in seconds (server - local). */
export function computeClockOffset(
  serverDate: string,
  requestStartMs: number,
  responseEndMs: number,
): number | null {
  const server = Date.parse(serverDate);
  if (Number.isNaN(server)) return null;
  const local = (requestStartMs + responseEndMs) / 2;
  return Math.round((server - local) / 1000);
}
