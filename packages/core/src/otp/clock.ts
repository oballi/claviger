/** Bu eşikten büyük kayma kaydedilir ve kullanıcıya gösterilir (spec §8). */
export const CLOCK_OFFSET_THRESHOLD_SEC = 30;

/** Sunucunun `Date` başlığını isteğin orta anıyla karşılaştırır. Saniye cinsinden ofset döner (sunucu − yerel). */
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
