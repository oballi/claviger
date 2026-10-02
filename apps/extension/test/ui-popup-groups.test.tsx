// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

async function seeded() {
  const h = await harness();
  const work = await h.ui.rpc("createGroup", { name: "Work" });
  const home = await h.ui.rpc("createGroup", { name: "Home" });
  const add = async (issuer: string, secret: string, groupId: string | null, pinned = false) => {
    const { id } = await h.ui.rpc("addAccountManual", { draft: { secret, issuer } });
    if (groupId) await h.ui.rpc("setAccountGroup", { id, groupId });
    if (pinned) await h.ui.rpc("setPinned", { id, pinned: true });
    return id;
  };
  await add("Alpha", "JBSWY3DPEHPK3PXA", work.id);
  await add("Beta", "JBSWY3DPEHPK3PXB", work.id, true);
  await add("Gamma", "JBSWY3DPEHPK3PXC", home.id);
  await add("Delta", "JBSWY3DPEHPK3PXD", null);
  return h;
}

beforeEach(() => localStorage.clear());

describe("popup groups", () => {
  it("opens the manage page from the header", async () => {
    const h = await harness();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Yönetim sayfası" }));
    expect(h.ui.openManage).toHaveBeenCalledWith();
  });

  it("shows group sections with counts, pinned first, then ungrouped", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const headers = await screen.findAllByRole("button", { expanded: true });
    expect(headers.map((b) => b.textContent)).toEqual(["Work2", "Home1", "Grupsuz1"]);
    const work = screen.getByRole("region", { name: /Work/ });
    expect(
      within(work)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining("Beta"), expect.stringContaining("Alpha")]);
    expect(within(work).getByText(/sabit/)).toBeTruthy();
  });

  it("keeps the old layout when there are no groups", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountManual", { draft: { secret: "JBSWY3DPEHPK3PXA", issuer: "Alpha" } });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    expect(await screen.findByRole("heading", { name: "Tüm hesaplar" })).toBeTruthy();
    expect(screen.queryByText("Grupsuz")).toBeNull();
  });

  it("collapses a group and remembers it on this device", async () => {
    const h = await seeded();
    const first = renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /Work/ }));
    expect(screen.queryByText("Alpha")).toBeNull();
    first.unmount();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    expect(await screen.findByRole("button", { name: /Work/, expanded: false })).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("works when localStorage throws", async () => {
    const h = await seeded();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    expect(await screen.findByText("Alpha")).toBeTruthy();
    spy.mockRestore();
  });

  it("ignores groups while searching", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.type(await screen.findByRole("searchbox", { name: "Hesap ara" }), "a");
    expect(await screen.findByRole("heading", { name: "Sonuçlar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Work/ })).toBeNull();
  });

  it("still toggles when setItem throws", async () => {
    const h = await seeded();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /Work/ }));
    expect(screen.queryByText("Alpha")).toBeNull();
    spy.mockRestore();
  });

  it.each(["{not json", '{"a":1}', '"Work"', "42"])(
    "treats stored %s as all expanded",
    async (raw) => {
      const h = await seeded();
      localStorage.setItem("claviger.popup.collapsed", raw);
      renderUi(<PopupApp pollMs={0} />, h.ui);
      expect(await screen.findByText("Alpha")).toBeTruthy();
      expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(3);
    },
  );

  it("prunes stale keys and ignores oversized entries", async () => {
    const h = await seeded();
    localStorage.setItem(
      "claviger.popup.collapsed",
      JSON.stringify(["dead-group", "x".repeat(65)]),
    );
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /Home/ }));
    const stored = JSON.parse(localStorage.getItem("claviger.popup.collapsed") ?? "[]") as string[];
    expect(stored).toHaveLength(1);
    expect(stored).not.toContain("dead-group");
  });

  it("migrates the legacy collapsed key once", async () => {
    const h = await seeded();
    localStorage.setItem("otpv.popup.collapsed", JSON.stringify(["dead-group"]));
    renderUi(<PopupApp pollMs={0} />, h.ui);
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(localStorage.getItem("claviger.popup.collapsed")).toBe('["dead-group"]');
    expect(localStorage.getItem("otpv.popup.collapsed")).toBeNull();
  });

  it("wires aria-controls only while open", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const button = await screen.findByRole("button", { name: /Work/ });
    const id = button.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? "")?.tagName).toBe("UL");
    await userEvent.click(button);
    expect(button.getAttribute("aria-controls")).toBeNull();
  });

  it("keeps a site-matched account in Bu site, not in its group", async () => {
    const h = await harness({ tabUrl: "https://acme.com/login" });
    const g = await h.ui.rpc("createGroup", { name: "Work" });
    const { id } = await h.ui.rpc("addAccountManual", {
      draft: { secret: "JBSWY3DPEHPK3PXA", issuer: "Acme", domains: ["acme.com"] },
    });
    await h.ui.rpc("setAccountGroup", { id, groupId: g.id });
    await h.ui.rpc("addAccountManual", { draft: { secret: "JBSWY3DPEHPK3PXB", issuer: "Other" } });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const site = await screen.findByRole("region", { name: /Bu site/ });
    expect(within(site).getByText("Acme")).toBeTruthy();
    expect(screen.getAllByText("Acme")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: /Work/ })).toBeNull();
  });
});
