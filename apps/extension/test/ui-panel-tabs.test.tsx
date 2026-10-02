// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UiPlatform } from "@claviger/ui";
import { CodesScreen } from "@claviger/ui/popup";
import { AUTOLOCK_ALARM } from "../src/background/vaultService";
import { harness, renderUi, type Harness } from "./helpers/ui";

afterEach(cleanup);

const A = "https://a.example/login";
const EVIL = "https://evil.example/";

async function seeded(
  lockPolicy?: Parameters<typeof harness>[0] extends infer O
    ? O extends { lockPolicy?: infer L }
      ? L
      : never
    : never,
) {
  const h = await harness({ lockPolicy });
  await h.ui.rpc("addAccountUri", {
    uri: "otpauth://totp/AlphaCorp:me?secret=JBSWY3DPEHPK3PXP&issuer=AlphaCorp",
    sourceUrl: "https://a.example",
  });
  return h;
}

interface Call {
  pageUrl?: string;
  passive?: boolean;
}

/** A panel-like platform: a switchable tab, a change listener and gated listAccounts replies. */
function panel(h: Harness, initial: string) {
  const s = {
    tab: initial as string | undefined,
    tabGate: null as Promise<void> | null,
    fire: () => {},
    calls: [] as Call[],
    gates: [] as { call: Call; release: () => void }[],
    hold: false,
  };
  const real = h.ui.rpc as (t: string, p: unknown) => Promise<unknown>;
  const ui: UiPlatform = {
    ...h.ui,
    rpc: (async (type: string, payload: Call) => {
      if (type !== "listAccounts") return real(type, payload);
      s.calls.push(payload);
      const result = await real(type, payload);
      if (!s.hold) return result;
      return new Promise<unknown>((resolve) =>
        s.gates.push({ call: payload, release: () => resolve(result) }),
      );
    }) as UiPlatform["rpc"],
    activeTab: async () => {
      const url = s.tab;
      if (s.tabGate) await s.tabGate;
      return url ? { id: 1, url } : undefined;
    },
    onActiveTabChange: (l) => {
      s.fire = l;
      return () => {};
    },
  };
  return { s, ui };
}

const render = async (h: Harness, ui: UiPlatform) =>
  renderUi(<CodesScreen state={await h.service.getState()} pollMs={0} onLocked={() => {}} />, ui);

describe("panel tab switches", () => {
  it("never renders A's account under 'Bu site' after switching to another site", async () => {
    const h = await seeded();
    const { s, ui } = panel(h, A);
    await render(h, ui);
    expect(await screen.findByText("Bu site")).toBeTruthy();
    s.hold = true;
    s.tab = EVIL;
    act(() => s.fire());
    // The evil site's list is still in flight: A's match must already be gone.
    await waitFor(() => expect(s.gates.length).toBe(1));
    expect(screen.queryByText("Bu site")).toBeNull();
    s.gates[0]!.release();
    await waitFor(() => expect(screen.queryByText("AlphaCorp")).toBeTruthy());
    expect(screen.queryByText("Bu site")).toBeNull();
  });

  it("drops a delayed response for the previous site (out of order)", async () => {
    const h = await seeded();
    const { s, ui } = panel(h, A);
    s.hold = true;
    await render(h, ui);
    await waitFor(() => expect(s.gates.length).toBe(1));
    s.tab = EVIL;
    act(() => s.fire());
    await waitFor(() => expect(s.gates.length).toBe(2));
    s.gates[1]!.release();
    await waitFor(() => expect(screen.queryByText("AlphaCorp")).toBeTruthy());
    // A's reply arrives last and must not replace the evil site's list.
    await act(async () => s.gates[0]!.release());
    expect(screen.queryByText("Bu site")).toBeNull();
  });

  it("drops an older response for the same site after a newer request", async () => {
    const h = await seeded();
    const { s, ui } = panel(h, A);
    s.hold = true;
    await render(h, ui);
    await waitFor(() => expect(s.gates.length).toBe(1));
    s.tab = EVIL;
    act(() => s.fire());
    await waitFor(() => expect(s.gates.length).toBe(2));
    await h.ui.rpc("addAccountUri", {
      uri: "otpauth://totp/BetaCorp:me?secret=GEZDGNBVGY3TQOJQ&issuer=BetaCorp",
    });
    s.tab = A;
    act(() => s.fire());
    await waitFor(() => expect(s.gates.length).toBe(3));
    s.gates[2]!.release();
    await screen.findByText("BetaCorp");
    await act(async () => s.gates[0]!.release());
    expect(screen.queryByText("BetaCorp")).toBeTruthy();
  });

  it("ignores a tab resolution that was superseded by a newer one", async () => {
    const h = await seeded();
    const { s, ui } = panel(h, A);
    await render(h, ui);
    expect(await screen.findByText("Bu site")).toBeTruthy();
    // First re-resolve (still showing A) stays pending; the second one lands on the evil site.
    let releaseOld: () => void = () => {};
    s.tabGate = new Promise<void>((r) => (releaseOld = r));
    act(() => s.fire());
    s.tabGate = null;
    s.tab = EVIL;
    act(() => s.fire());
    await waitFor(() => expect(screen.queryByText("Bu site")).toBeNull());
    s.tab = A;
    await act(async () => releaseOld());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Bu site")).toBeNull();
  });

  it("tab events only send passive listAccounts and cannot keep the vault unlocked", async () => {
    const h = await seeded({ kind: "timeout", minutes: 15 });
    const { s, ui } = panel(h, A);
    await render(h, ui);
    await screen.findByText("Bu site");
    const due = h.p.alarms.scheduled.get(AUTOLOCK_ALARM)!;
    const first = s.calls.length;
    for (let i = 0; i < 16; i++) {
      h.p.clock.advance(60_000);
      s.tab = i % 2 ? A : EVIL;
      act(() => s.fire());
      await waitFor(() => expect(s.calls.length).toBe(first + i + 1));
    }
    expect(s.calls.slice(first).every((c) => c.passive === true)).toBe(true);
    expect(h.p.alarms.scheduled.get(AUTOLOCK_ALARM)).toBe(due);
    await h.service.handleAlarm(AUTOLOCK_ALARM);
    expect((await h.service.getState()).status).toBe("locked");
  });
});
