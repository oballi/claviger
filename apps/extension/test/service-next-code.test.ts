import { generateCode } from "@claviger/core";
import { describe, expect, it } from "vitest";
import { NEXT_CODE_WINDOW_SEC } from "../src/background/vaultService";
import { saveSettings } from "../src/background/settings";
import { unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const BASE = 1_700_000_000_000 - 20_000; // a multiple of 30 s

async function nextAt(
  uri: string,
  remaining: number,
  period = 30,
  offsetSec = 0,
  showLastSeconds = true,
) {
  const { p, service } = await unlockedService();
  await saveSettings(p.local, { clockOffsetSec: offsetSec, showLastSeconds });
  await service.addAccount({ uri });
  p.clock.ms = BASE + (period - remaining) * 1000 - offsetSec * 1000;
  const view = (await service.listAccounts()).accounts[0]!;
  return { view, now: p.clock.now() };
}

describe("next code window", () => {
  it("has a 7 s window", () => expect(NEXT_CODE_WINDOW_SEC).toBe(7));

  it("is null with 8 s left and present with 7 s left", async () => {
    const uri = `otpauth://totp/x?secret=${SECRET}`;
    const before = await nextAt(uri, 8);
    expect(before.view.remaining).toBe(8);
    expect(before.view.nextCode).toBeNull();
    const inside = await nextAt(uri, 7);
    expect(inside.view.remaining).toBe(7);
    const expected = await generateCode(
      { type: "totp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 0 },
      inside.now + 30_000,
    );
    expect(inside.view.nextCode).toBe(expected.code);
    expect(inside.view.nextCode).not.toBe(inside.view.code);
  });

  it("is never sent while the setting is off (the default)", async () => {
    const { service } = await unlockedService();
    expect((await service.getState()).showLastSeconds).toBe(false);
    const { view } = await nextAt(`otpauth://totp/x?secret=${SECRET}`, 3, 30, 0, false);
    expect(view.remaining).toBe(3);
    expect(view.nextCode).toBeNull();
  });

  it("uses the clock offset for both the window and the code", async () => {
    const { view, now } = await nextAt(`otpauth://totp/x?secret=${SECRET}`, 3, 30, 120);
    expect(view.remaining).toBe(3);
    const expected = await generateCode(
      { type: "totp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 0 },
      now + 30_000,
      120,
    );
    expect(view.nextCode).toBe(expected.code);
  });

  it("is never sent for periods not longer than the window", async () => {
    const { view } = await nextAt(`otpauth://totp/x?secret=${SECRET}&period=6`, 3, 6);
    expect(view.remaining).toBeLessThanOrEqual(6);
    expect(view.nextCode).toBeNull();
  });

  it("is not sent when the period is shorter than twice the window", async () => {
    const { view } = await nextAt(`otpauth://totp/x?secret=${SECRET}&period=8`, 5, 8);
    expect(view.remaining).toBeLessThanOrEqual(7);
    expect(view.nextCode).toBeNull();
  });

  it("is never sent for HOTP", async () => {
    const { view } = await nextAt(`otpauth://hotp/x?secret=${SECRET}&counter=1`, 3);
    expect(view.remaining).toBeNull();
    expect(view.nextCode).toBeNull();
  });

  it("applies to Steam accounts inside the window only", async () => {
    const run = async (remaining: number) => {
      const { p, service } = await unlockedService();
      await service.setShowLastSeconds(true);
      await service.addAccount({ draft: { secret: SECRET, type: "steam", issuer: "Steam" } });
      p.clock.ms = BASE + (30 - remaining) * 1000;
      return (await service.listAccounts()).accounts[0]!;
    };
    expect((await run(8)).nextCode).toBeNull();
    const inside = await run(7);
    expect(inside.nextCode).toMatch(/^[0-9A-Z]{5}$/);
    expect(inside.nextCode).not.toBe(inside.code);
  });
});
