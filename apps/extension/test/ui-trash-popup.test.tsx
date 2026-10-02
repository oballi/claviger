// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UndoToast } from "@otp-vault/ui";
import { PopupApp } from "@otp-vault/ui/popup";
import { useState } from "react";
import { RpcError } from "@otp-vault/ui";
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
