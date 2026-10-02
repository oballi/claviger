// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UndoToast } from "@claviger/ui";
import { PopupApp } from "@claviger/ui/popup";
import { useState } from "react";
import { RpcError } from "@claviger/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, renderUi, type Harness } from "./helpers/ui";

async function seeded() {
  const h = await harness();
  const ids: Record<string, string> = {};
  for (const [issuer, secret] of [
    ["Alpha", "JBSWY3DPEHPK3PXA"],
    ["Beta", "JBSWY3DPEHPK3PXB"],
  ] as const)
    ids[issuer] = (await h.ui.rpc("addAccountManual", { draft: { secret, issuer } })).id;
  return { ...h, ids };
}

const trigger = (name: string) => screen.findByRole("button", { name: `${name} için işlemler` });

async function deleteViaMenu(name: string) {
  await userEvent.click(await trigger(name));
  await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
  await userEvent.click(screen.getByRole("button", { name: "Sil" }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("undo after delete", () => {
  it("mentions the bin in the delete confirmation", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Son silinenler");
  });

  it("announces the deletion in a status region and restores on Geri al", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await deleteViaMenu("Beta");
    const message = await screen.findByText("Beta silindi");
    expect(message.closest('[role="status"]')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Geri al" }));
    expect(await screen.findByText("Beta geri yüklendi")).toBeTruthy();
    const accounts = (await h.ui.rpc("listAccounts", {})).accounts;
    expect(accounts.map((a) => a.issuer).sort()).toEqual(["Alpha", "Beta"]);
    expect(await h.ui.rpc("listTrash", {})).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("moves focus to Geri al after a keyboard delete, and Esc dismisses it back to search", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    // The confirm button is auto-focused; activating it by keyboard marks the delete as keyboard-driven.
    await userEvent.keyboard("{Enter}");
    const undo = await screen.findByRole("button", { name: "Geri al" });
    await waitFor(() => expect(document.activeElement).toBe(undo));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Geri al" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    // The account stays in the bin.
    expect((await h.ui.rpc("listTrash", {})).map((i) => i.id)).toHaveLength(1);
  });

  it("offers no undo when the account could not be binned", async () => {
    const h = await seeded();
    const ui = {
      ...h.ui,
      rpc: ((type: string, payload: unknown) =>
        type === "listTrash"
          ? Promise.resolve([])
          : (h.ui.rpc as (t: string, p: unknown) => Promise<unknown>)(
              type,
              payload,
            )) as Harness["ui"]["rpc"],
    };
    renderUi(<PopupApp pollMs={0} />, ui);
    await deleteViaMenu("Beta");
    expect(await screen.findByText("Beta silindi.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Geri al" })).toBeNull();
  });

  it("a second delete replaces the toast; the first stays in the bin", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await deleteViaMenu("Beta");
    await screen.findByText("Beta silindi");
    await deleteViaMenu("Alpha");
    await screen.findByText("Alpha silindi");
    expect(screen.queryByText("Beta silindi")).toBeNull();
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(2);
  });
});

describe("UndoToast timing", () => {
  async function mount(props: Partial<Parameters<typeof UndoToast>[0]> = {}) {
    const h = await harness();
    const onDone = vi.fn();
    const onUndo = vi.fn();
    renderUi(
      <UndoToast
        message="X silindi"
        onUndo={onUndo}
        onDone={onDone}
        onDismiss={vi.fn()}
        timeoutMs={60}
        {...props}
      />,
      h.ui,
    );
    return { onDone, onUndo };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("closes itself after the timeout", async () => {
    const { onDone } = await mount();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("stays while hovered and restarts the full wait after the pointer leaves", async () => {
    const { onDone } = await mount();
    const status = screen.getByText("X silindi").closest('[role="status"]')!;
    await userEvent.hover(status);
    await wait(150);
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.unhover(status);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("stays while the button has focus", async () => {
    const { onDone } = await mount();
    screen.getByRole("button", { name: "Geri al" }).focus();
    await wait(150);
    expect(onDone).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Geri al" }).blur();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

describe("undo toast fix round 1", () => {
  it("a second delete with the same name gets a fresh offer and keyboard focus", async () => {
    const h = await harness();
    for (const [secret, label] of [
      ["JBSWY3DPEHPK3PXA", "a@x.com"],
      ["JBSWY3DPEHPK3PXB", "b@x.com"],
    ] as const)
      await h.ui.rpc("addAccountManual", { draft: { secret, issuer: "Google", label } });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    for (let i = 0; i < 2; i++) {
      await userEvent.click(
        (await screen.findAllByRole("button", { name: "Google için işlemler" }))[0]!,
      );
      await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
      await userEvent.keyboard("{Enter}");
      const undo = await screen.findByRole("button", { name: "Geri al" });
      await waitFor(() => expect(document.activeElement).toBe(undo));
      if (i === 0)
        await waitFor(() =>
          expect(screen.getAllByRole("button", { name: "Google için işlemler" })).toHaveLength(1),
        );
    }
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(2);
  });

  it("drops the offer when the add view opens", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await deleteViaMenu("Beta");
    await screen.findByText("Beta silindi");
    await userEvent.click(screen.getByRole("button", { name: "Hesap ekle" }));
    await userEvent.click(await screen.findByRole("button", { name: "Geri" }));
    await screen.findByRole("searchbox");
    expect(screen.queryByText("Beta silindi")).toBeNull();
  });

  it("raises the regular toast above the undo toast", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await deleteViaMenu("Beta");
    await screen.findByText("Beta silindi");
    await userEvent.click((await screen.findAllByRole("button", { name: /^Alpha/ }))[0]!);
    const copied = await screen.findByText(/kodu kopyalandı/);
    expect(copied.closest('[role="status"]')!.className).toContain("bottom-[84px]");
  });

  it("shows the error when the entry is already gone", async () => {
    const h = await seeded();
    const ui = {
      ...h.ui,
      rpc: ((type: string, payload: unknown) =>
        type === "restoreTrash"
          ? Promise.reject(new RpcError("trash-entry-not-found", "x"))
          : (h.ui.rpc as (t: string, p: unknown) => Promise<unknown>)(
              type,
              payload,
            )) as Harness["ui"]["rpc"],
    };
    renderUi(<PopupApp pollMs={0} />, ui);
    await deleteViaMenu("Beta");
    await userEvent.click(await screen.findByRole("button", { name: "Geri al" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "artık son silinenlerde değil",
    );
  });
});

describe("UndoToast timers", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("uses an 8 s default", async () => {
    const h = await harness();
    vi.useFakeTimers();
    const onDone = vi.fn();
    renderUi(
      <UndoToast message="X silindi" onUndo={vi.fn()} onDone={onDone} onDismiss={vi.fn()} />,
      h.ui,
    );
    await vi.advanceTimersByTimeAsync(7900);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("holds while hovered or focused, tracked separately", async () => {
    const h = await harness();
    const onDone = vi.fn();
    renderUi(
      <UndoToast
        message="X silindi"
        onUndo={vi.fn()}
        onDone={onDone}
        onDismiss={vi.fn()}
        timeoutMs={60}
      />,
      h.ui,
    );
    const status = screen.getByText("X silindi").closest('[role="status"]')!;
    const button = screen.getByRole("button", { name: "Geri al" });
    await userEvent.hover(status);
    button.focus();
    await userEvent.unhover(status);
    await wait(150);
    expect(onDone).not.toHaveBeenCalled();
    button.blur();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("restarts the wait when the token changes", async () => {
    const h = await harness();
    const onDone = vi.fn();
    let next: () => void = () => {};
    function Host() {
      const [n, setN] = useState(0);
      next = () => setN((v) => v + 1);
      return (
        <UndoToast
          message="X silindi"
          token={String(n)}
          onUndo={vi.fn()}
          onDone={onDone}
          onDismiss={vi.fn()}
          timeoutMs={200}
        />
      );
    }
    renderUi(<Host />, h.ui);
    await wait(120);
    next();
    await wait(120);
    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("clears the timer on unmount", async () => {
    const h = await harness();
    const onDone = vi.fn();
    const view = renderUi(
      <UndoToast
        message="X silindi"
        onUndo={vi.fn()}
        onDone={onDone}
        onDismiss={vi.fn()}
        timeoutMs={40}
      />,
      h.ui,
    );
    view.unmount();
    await wait(120);
    expect(onDone).not.toHaveBeenCalled();
  });
});

const DAY = 86_400_000;
const restoreBtn = (name: string) =>
  screen.findByRole("button", { name: `${name} hesab\u0131n\u0131 geri y\u00fckle` });

describe("recently deleted list in the popup", () => {
  it("shows no link while the bin is empty and a count once something is deleted", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await trigger("Alpha");
    expect(screen.queryByRole("button", { name: /Son silinenler/ })).toBeNull();
    await deleteViaMenu("Beta");
    expect(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" })).toBeTruthy();
  });

  it("lists deleted accounts without any code and restores one", async () => {
    const h = await harness();
    const { id } = await h.ui.rpc("addAccountManual", {
      draft: { secret: "JBSWY3DPEHPK3PXA", issuer: "Instagram", label: "omer.balli" },
    });
    await h.ui.rpc("deleteAccount", { id });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    expect(await screen.findByRole("heading", { name: "Son silinenler." })).toBeTruthy();
    expect(screen.getByText("Instagram")).toBeTruthy();
    expect(
      screen.getByText("omer.balli \u00b7 bug\u00fcn silindi \u00b7 30 g\u00fcn kald\u0131"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d{3}\s?\d{3}/);
    expect(document.body.textContent).not.toContain("JBSWY3DPEHPK3PXA");
    expect(document.body.textContent).not.toMatch(/kal\u0131c\u0131|permanent/i);
    await userEvent.click(await restoreBtn("Instagram"));
    expect(await screen.findByText("Instagram geri y\u00fcklendi")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Son silinenler/ })).toBeNull();
    expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual([
      "Instagram",
    ]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("searchbox")));
  });

  it("shows older entries with their age and days left", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    h.p.clock.advance(26 * DAY);
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    expect(
      await screen.findByText("26 g\u00fcn \u00f6nce silindi \u00b7 4 g\u00fcn kald\u0131"),
    ).toBeTruthy();
  });

  it("keeps focus inside the view after a restore and goes back on Escape", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Alpha! });
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 2" }));
    await userEvent.click((await screen.findAllByRole("button", { name: /geri y\u00fckle$/ }))[0]!);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /geri y\u00fckle$/ })).toHaveLength(1),
    );
    const remaining = screen.getAllByRole("button", { name: /geri y\u00fckle$/ });
    await waitFor(() => expect(document.activeElement).toBe(remaining[0]));
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Son silinenler." })).toBeNull();
  });

  it("goes back with the back button", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    await userEvent.click(await screen.findByRole("button", { name: "Geri" }));
    expect(await screen.findByRole("searchbox")).toBeTruthy();
  });

  it("shows a duplicate as an alert and keeps the entry", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    await h.ui.rpc("addAccountManual", {
      draft: { secret: "JBSWY3DPEHPK3PXB", issuer: "Beta again" },
    });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    await userEvent.click(await restoreBtn("Beta"));
    expect((await screen.findByRole("alert")).textContent).toContain("zaten kay\u0131tl\u0131");
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(1);
    // The button stays usable (aria-disabled only while a restore runs) and keeps focus.
    expect(document.activeElement).toBe(await restoreBtn("Beta"));
  });

  it("does not start a second restore while one is running", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Alpha! });
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const ui = {
      ...h.ui,
      rpc: (async (type: string, payload: unknown) => {
        if (type === "restoreTrash") {
          calls++;
          await gate;
        }
        return (h.ui.rpc as (t: string, p: unknown) => Promise<unknown>)(type, payload);
      }) as Harness["ui"]["rpc"],
    };
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 2" }));
    const buttons = await screen.findAllByRole("button", { name: /geri y\u00fckle$/ });
    await userEvent.click(buttons[0]!);
    await userEvent.click(buttons[1]!);
    expect(buttons[1]!.getAttribute("aria-disabled")).toBe("true");
    release();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /geri y\u00fckle$/ })).toHaveLength(1),
    );
    expect(calls).toBe(1);
  });

  it("refreshes the list when the entry is already gone", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    const ui = {
      ...h.ui,
      rpc: ((type: string, payload: unknown) =>
        type === "restoreTrash"
          ? Promise.reject(new RpcError("trash-entry-not-found", "x"))
          : (h.ui.rpc as (t: string, p: unknown) => Promise<unknown>)(
              type,
              payload,
            )) as Harness["ui"]["rpc"],
    };
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    await userEvent.click(await restoreBtn("Beta"));
    expect((await screen.findByRole("alert")).textContent).toContain("son silinenlerde de\u011fil");
  });

  it("drops a pending undo offer when the list opens", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await deleteViaMenu("Beta");
    await screen.findByText("Beta silindi");
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    await screen.findByRole("heading", { name: "Son silinenler." });
    expect(screen.queryByText("Beta silindi")).toBeNull();
    expect(screen.queryByRole("button", { name: "Geri al" })).toBeNull();
  });

  it("shows the restored toast inside the list while entries remain", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Alpha! });
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 2" }));
    await userEvent.click(await restoreBtn("Alpha"));
    expect(await screen.findByText("Alpha geri y\u00fcklendi")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Son silinenler." })).toBeTruthy();
  });

  it("names an account without issuer or label in the restored toast", async () => {
    const h = await seeded();
    const { id } = await h.ui.rpc("addAccountManual", { draft: { secret: "JBSWY3DPEHPK3PXC" } });
    await h.ui.rpc("deleteAccount", { id });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler · 1" }));
    await userEvent.click(await restoreBtn("Hesap"));
    expect(await screen.findByText("Hesap geri yüklendi")).toBeTruthy();
  });

  it("does not steal '/' inside the list view", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Son silinenler \u00b7 1" }));
    await screen.findByRole("heading", { name: "Son silinenler." });
    await userEvent.keyboard("/");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("shows the bin link first on an empty popup and hides the snapshot offer meanwhile", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Alpha! });
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    const ui = h.ui;
    renderUi(<PopupApp pollMs={0} />, ui);
    const link = await screen.findByRole("button", { name: "Son silinenler \u00b7 2" });
    const add = screen.getAllByRole("button", { name: "Hesap ekle" }).at(-1)!;
    expect(link.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/kasa kopyas\u0131|Kopya/)).toBeNull();
  });

  it("does not flash the snapshot offer before the bin has loaded", async () => {
    const h = await harness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ui: typeof h.ui = {
      ...h.ui,
      rpc: (async (type: string, payload: unknown) => {
        if (type === "getState")
          return { ...(await h.ui.rpc("getState", {})), snapshotOffer: { accountCount: 3 } };
        if (type === "listTrash") await gate;
        return h.ui.rpc(type as never, payload as never);
      }) as typeof h.ui.rpc,
    };
    renderUi(<PopupApp pollMs={0} />, ui);
    await screen.findByText("Hen\u00fcz hesap yok.");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Otomatik kopyadan/)).toBeNull();
    release();
    expect(await screen.findByText(/Otomatik kopyadan/)).toBeTruthy();
  });

  it("renders in English", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Beta! });
    renderUi(<PopupApp pollMs={0} />, h.ui, "en");
    await userEvent.click(await screen.findByRole("button", { name: "Recently deleted \u00b7 1" }));
    expect(await screen.findByRole("heading", { name: "Recently deleted." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore Beta" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/for good|permanent/i);
  });
});
