// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PopupApp } from "@otp-vault/ui/popup";
import { harness, renderUi, type Harness } from "./helpers/ui";

const dt = () => ({ setData() {}, getData: () => "", effectAllowed: "" });

async function seeded(opts: { tabUrl?: string } = {}) {
  const h = await harness({ tabUrl: opts.tabUrl ?? "https://github.com/login" });
  const work = await h.ui.rpc("createGroup", { name: "Work" });
  const home = await h.ui.rpc("createGroup", { name: "Home" });
  const ids: Record<string, string> = {};
  const add = async (issuer: string, secretTail: string, groupId?: string) => {
    ids[issuer] = (
      await h.ui.rpc("addAccountManual", {
        draft: { secret: `JBSWY3DPEHPK3PX${secretTail}`, issuer },
      })
    ).id;
    if (groupId) await h.ui.rpc("setAccountGroup", { id: ids[issuer], groupId });
  };
  await add("Pin", "A", work.id);
  await add("W1", "B", work.id);
  await add("W2", "C", work.id);
  await add("W3", "D", work.id);
  await add("H1", "E", home.id);
  await add("L1", "F");
  await add("Site", "G");
  await h.ui.rpc("setPinned", { id: ids.Pin!, pinned: true });
  await h.ui.rpc("updateAccount", { id: ids.Site!, patch: { domains: ["github.com"] } });
  return { ...h, ids, work, home };
}
type Seeded = Awaited<ReturnType<typeof seeded>>;

const toggle = () => screen.findByRole("button", { name: "Sırala" });
const up = (n: string) => screen.getByRole("button", { name: `${n} hesabını yukarı taşı` });
const down = (n: string) => screen.getByRole("button", { name: `${n} hesabını aşağı taşı` });
const rowOf = (h: Seeded, n: string) =>
  document.querySelector<HTMLElement>(`[data-sort-row="${h.ids[n]}"]`)!;
const headerOf = (key: string) =>
  document.querySelector<HTMLElement>(`[data-sort-group="${key}"]`)!;
const names = async (h: Harness) => {
  const { accounts } = await h.ui.rpc("listAccounts", {});
  return accounts.map((a) => a.issuer);
};
async function enter(h: Seeded) {
  renderUi(<PopupApp pollMs={0} />, h.ui);
  await userEvent.click(await toggle());
  await screen.findByRole("button", { name: "Bitti" });
}
function drag(source: HTMLElement, target: HTMLElement) {
  fireEvent.dragStart(source, { dataTransfer: dt() });
  fireEvent.dragOver(target, { dataTransfer: dt() });
  fireEvent.drop(target, { dataTransfer: dt() });
  fireEvent.dragEnd(source, { dataTransfer: dt() });
}

beforeEach(() => localStorage.clear());

describe("popup sort mode", () => {
  it("toggles with aria-pressed and hides codes, search and row menus", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const button = await toggle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await screen.findByRole("searchbox");
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /için işlemler/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d{3} ?\d{3}/);
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByRole("searchbox")).toBeTruthy();
  });

  it("shows a hint bar and a Done button; Done leaves the mode and focuses the toggle", async () => {
    const h = await seeded();
    await enter(h);
    expect(screen.getByText(/Sürükle ya da/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Bitti" }));
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sırala" }));
  });

  it("Escape leaves the mode, keeps the query and focuses the toggle", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const box = await screen.findByRole("searchbox");
    await userEvent.type(box, "W");
    await userEvent.click(await toggle());
    await screen.findByRole("button", { name: "Bitti" });
    await userEvent.click(down("W1"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Bitti" })).toBeNull();
    expect(((await screen.findByRole("searchbox")) as HTMLInputElement).value).toBe("W");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sırala" }));
  });

  it("Escape still leaves the mode after focus fell to the body", async () => {
    const h = await seeded();
    await enter(h);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sırala" }));
  });

  it("the / shortcut does nothing while sorting", async () => {
    const h = await seeded();
    await enter(h);
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("/");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("entering sort mode dismisses a pending undo toast", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "L1 için işlemler" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    await userEvent.click(screen.getByRole("button", { name: "Sil" }));
    await screen.findByRole("button", { name: "Geri al" });
    await userEvent.click(await toggle());
    expect(screen.queryByRole("button", { name: "Geri al" })).toBeNull();
  });

  it("shows collapsed groups open while sorting and restores them afterwards", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /Home/ }));
    expect(screen.queryByText("H1")).toBeNull();
    await userEvent.click(await toggle());
    expect(await screen.findByText("H1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Bitti" }));
    await screen.findByRole("searchbox");
    expect(screen.queryByText("H1")).toBeNull();
    expect(screen.getByRole("button", { name: /Home/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("moves a row down with the arrow button and keeps focus on that row's button", async () => {
    const h = await seeded();
    await enter(h);
    await userEvent.click(down("W1"));
    await waitFor(async () =>
      expect((await names(h)).filter((n) => n.startsWith("W"))).toEqual(["W2", "W1", "W3"]),
    );
    await waitFor(() => expect(document.activeElement).toBe(down("W1")));
  });

  it("disables up on the first and down on the last row of a group; focus goes to the opposite button at the edge", async () => {
    const h = await seeded();
    await enter(h);
    expect((up("W1") as HTMLButtonElement).disabled).toBe(true);
    expect((down("W3") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(down("W2"));
    await waitFor(() => expect((down("W2") as HTMLButtonElement).disabled).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(up("W2")));
  });

  it("ignores a second arrow click while the first is in flight", async () => {
    const h = await seeded();
    const real = h.ui.rpc;
    let reorders = 0;
    h.ui.rpc = (async (type: string, ...rest: unknown[]) => {
      if (type === "reorder") {
        reorders += 1;
        await new Promise((r) => setTimeout(r, 60));
      }
      return (real as (...a: unknown[]) => unknown)(type, ...rest);
    }) as typeof real;
    await enter(h);
    await userEvent.click(down("W1"));
    await userEvent.click(down("W1"));
    await waitFor(async () =>
      expect((await names(h)).filter((n) => n.startsWith("W"))).toEqual(["W2", "W1", "W3"]),
    );
    expect(reorders).toBe(1);
  });

  it("dropping a row on a row of another group moves it there, before that row", async () => {
    const h = await seeded();
    await enter(h);
    drag(rowOf(h, "W1"), rowOf(h, "H1"));
    await waitFor(async () => {
      const { accounts } = await h.ui.rpc("listAccounts", {});
      const w1 = accounts.find((a) => a.id === h.ids.W1)!;
      expect(w1.groupId).toBe(h.home.id);
      const order = accounts.map((a) => a.issuer);
      expect(order.indexOf("W1")).toBe(order.indexOf("H1") - 1);
    });
    expect(await screen.findByText("W1 → Home")).toBeTruthy();
  });

  it("dropping downward inside a group lands below the target", async () => {
    const h = await seeded();
    await enter(h);
    drag(rowOf(h, "W1"), rowOf(h, "W2"));
    await waitFor(async () =>
      expect((await names(h)).filter((n) => n.startsWith("W"))).toEqual(["W2", "W1", "W3"]),
    );
    await waitFor(() => expect(document.activeElement).toBe(up("W1")));
  });

  it("dropping on a group header moves the row to the start of that group", async () => {
    const h = await seeded();
    await enter(h);
    drag(rowOf(h, "L1"), headerOf(h.work.id));
    await waitFor(async () => {
      const { accounts } = await h.ui.rpc("listAccounts", {});
      expect(accounts.find((a) => a.id === h.ids.L1)!.groupId).toBe(h.work.id);
      const order = accounts.map((a) => a.issuer);
      expect(order.indexOf("L1")).toBe(order.indexOf("W1") - 1);
    });
  });

  it("dropping on an empty group header fills it", async () => {
    const h = await seeded();
    const empty = await h.ui.rpc("createGroup", { name: "Empty" });
    await enter(h);
    drag(rowOf(h, "L1"), headerOf(empty.id));
    await waitFor(async () => {
      const { accounts } = await h.ui.rpc("listAccounts", {});
      expect(accounts.find((a) => a.id === h.ids.L1)!.groupId).toBe(empty.id);
    });
  });

  it("dropping on the ungrouped header ungroups the row", async () => {
    const h = await seeded();
    await enter(h);
    drag(rowOf(h, "W1"), headerOf("none"));
    await waitFor(async () => {
      const { accounts } = await h.ui.rpc("listAccounts", {});
      expect(accounts.find((a) => a.id === h.ids.W1)!.groupId).toBeFalsy();
    });
  });

  it("starts drags with a custom MIME type and never text/plain", async () => {
    const h = await seeded();
    await enter(h);
    const calls: string[] = [];
    const data = { ...dt(), setData: (type: string) => void calls.push(type) };
    fireEvent.dragStart(rowOf(h, "W1"), { dataTransfer: data });
    expect(calls).toEqual(["application/x-otp-vault-account"]);
    expect(data.effectAllowed).toBe("move");
  });

  it("pinned and 'this site' rows are dimmed, not draggable and not drop targets", async () => {
    const h = await seeded();
    await enter(h);
    const pinned = screen.getByText("Pin").closest("li")!;
    const site = screen.getByText("Site").closest("li")!;
    for (const li of [pinned, site]) {
      expect(li.getAttribute("aria-disabled")).toBe("true");
      expect(li.getAttribute("draggable")).toBeNull();
    }
    expect(pinned.className).toContain("opacity-55");
    expect(pinned.textContent).toContain("sabit");
    const before = await names(h);
    drag(rowOf(h, "W1"), pinned);
    drag(rowOf(h, "W1"), site);
    await new Promise((r) => setTimeout(r, 50));
    expect(await names(h)).toEqual(before);
  });

  it("highlights the row under the drag and clears it on drop", async () => {
    const h = await seeded();
    await enter(h);
    fireEvent.dragStart(rowOf(h, "W1"), { dataTransfer: dt() });
    fireEvent.dragOver(rowOf(h, "H1"), { dataTransfer: dt() });
    expect(rowOf(h, "H1").className).toContain("bg-hair");
    expect(rowOf(h, "W1").className).toContain("opacity-35");
    fireEvent.dragEnd(rowOf(h, "W1"), { dataTransfer: dt() });
    expect(rowOf(h, "H1").className).not.toContain("bg-hair");
  });

  it("shows an error and reloads when the target group was deleted meanwhile", async () => {
    const h = await seeded();
    await enter(h);
    await h.ui.rpc("deleteGroup", { id: h.home.id });
    drag(rowOf(h, "W1"), rowOf(h, "H1"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.id === h.ids.W1)!.groupId,
    ).toBe(h.work.id);
    await waitFor(() => expect(headerOf(h.home.id)).toBeNull());
  });
});
