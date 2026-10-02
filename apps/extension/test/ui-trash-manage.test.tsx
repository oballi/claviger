// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsScreen } from "@otp-vault/ui/manage";
import { describe, expect, it, vi } from "vitest";
import { harness, renderUi, type Harness } from "./helpers/ui";

const DAY = 86_400_000;

async function seeded() {
  const h = await harness();
  const ids: Record<string, string> = {};
  for (const [issuer, secret, label] of [
    ["Instagram", "JBSWY3DPEHPK3PXA", "omer.balli"],
    ["Dropbox", "JBSWY3DPEHPK3PXB", "obalii"],
    ["Keep", "JBSWY3DPEHPK3PXC", ""],
  ] as const)
    ids[issuer] = (await h.ui.rpc("addAccountManual", { draft: { secret, issuer, label } })).id;
  return { ...h, ids };
}

async function open(h: Harness, locale: "tr" | "en" = "tr") {
  const onChanged = vi.fn();
  renderUi(
    <AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={onChanged} pollMs={0} />,
    h.ui,
    locale,
  );
  const name = locale === "tr" ? "Son silinenler" : "Recently deleted";
  return { onChanged, section: await screen.findByRole("region", { name }) };
}

const ROW_REMOVE = "Dropbox hesabını listeden kaldır";

describe("manage: recently deleted", () => {
  it("explains the bin when empty", async () => {
    const h = await seeded();
    const { section } = await open(h);
    expect(await within(section).findByText("Silinen hesap yok.")).toBeTruthy();
    expect(section.textContent).toContain("e\u015fitlenmez");
    expect(within(section).queryByRole("button", { name: /Tümünü/ })).toBeNull();
  });

  it("lists service, account, deleted and remaining, with low days in the warning colour", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    h.p.clock.advance(26 * DAY);
    await h.ui.rpc("deleteAccount", { id: h.ids.Instagram! });
    const { section } = await open(h);
    const dropbox = (await within(section).findByText("Dropbox")).closest("tr")!;
    const instagram = within(section).getByText("Instagram").closest("tr")!;
    expect(within(dropbox).getByText("obalii")).toBeTruthy();
    expect(within(dropbox).getByText("4 gün").className).toContain("text-warn");
    expect(within(instagram).getByText("30 gün").className).not.toContain("text-warn");
    expect(within(instagram).getByText(/^bugün \d{2}:\d{2}$/)).toBeTruthy();
    expect(section.textContent).not.toContain("JBSWY3DPEHPK3PXA");
    expect(section.textContent).not.toMatch(/kalıcı|geri alınamaz/i);
  });

  it("restores a row, tells the page and refreshes the accounts table", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    const { section, onChanged } = await open(h);
    await userEvent.click(
      await within(section).findByRole("button", { name: "Dropbox hesabını geri yükle" }),
    );
    expect(await screen.findByText("Dropbox geri yüklendi.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(await within(section).findByText("Silinen hesap yok.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Dropbox.*düzenle/ })).toBeTruthy();
    expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer).sort()).toEqual([
      "Dropbox",
      "Instagram",
      "Keep",
    ]);
  });

  it("asks before removing one entry from the list, with honest wording, and only then does it", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    const { section } = await open(h);
    await userEvent.click(await within(section).findByRole("button", { name: ROW_REMOVE }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toMatch(/geri alınamaz|kalıcı/i);
    await userEvent.click(within(dialog).getByRole("button", { name: "Vazgeç" }));
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(1);
    await userEvent.click(within(section).getByRole("button", { name: ROW_REMOVE }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Listeden kaldır" }),
    );
    expect(await screen.findByText("Dropbox listeden kaldırıldı.")).toBeTruthy();
    expect(await h.ui.rpc("listTrash", {})).toEqual([]);
    // Only the bin entry goes: live accounts are untouched.
    expect((await h.ui.rpc("listAccounts", {})).accounts).toHaveLength(2);
  });

  it("moves focus to the next row after a removal, or to the section when none is left", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    await h.ui.rpc("deleteAccount", { id: h.ids.Instagram! });
    const { section } = await open(h);
    for (const name of ["Instagram", "Dropbox"]) {
      await userEvent.click(
        await within(section).findByRole("button", {
          name: `${name} hesabını listeden kaldır`,
        }),
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Listeden kaldır",
        }),
      );
      await within(section)
        .findByText(`${name} listeden kaldırıldı.`, {
          selector: "*",
        })
        .catch(() => undefined);
      await vi.waitFor(() => expect(section.contains(document.activeElement)).toBe(true));
    }
    expect(await within(section).findByText("Silinen hesap yok.")).toBeTruthy();
    expect(section.contains(document.activeElement)).toBe(true);
  });

  it("empties the whole list after a confirmation that names the count", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    await h.ui.rpc("deleteAccount", { id: h.ids.Instagram! });
    const { section } = await open(h);
    await userEvent.click(
      await within(section).findByRole("button", { name: "Tümünü listeden kaldır…" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("2");
    expect(dialog.textContent).not.toMatch(/geri alınamaz|kalıcı/i);
    await userEvent.click(within(dialog).getByRole("button", { name: "Listeden kaldır" }));
    expect(await screen.findByText("Son silinenler listesi boşaltıldı.")).toBeTruthy();
    expect(await h.ui.rpc("listTrash", {})).toEqual([]);
    expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual(["Keep"]);
  });

  it("shows a duplicate as an alert in the section and keeps the entry", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    await h.ui.rpc("addAccountManual", {
      draft: { secret: "JBSWY3DPEHPK3PXB", issuer: "Dropbox again" },
    });
    const { section } = await open(h);
    await userEvent.click(
      await within(section).findByRole("button", { name: "Dropbox hesabını geri yükle" }),
    );
    expect((await within(section).findByRole("alert")).textContent).toContain("zaten kayıtlı");
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(1);
  });

  it("refreshes the list after an account is deleted from the edit dialog", async () => {
    const h = await seeded();
    const { section } = await open(h);
    await userEvent.click(await screen.findByRole("button", { name: /Keep.*düzenle/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Sil" }));
    await userEvent.click(await screen.findByRole("button", { name: "Evet, sil" }));
    expect(await within(section).findByText("Keep")).toBeTruthy();
  });

  it("renders in English without permanence claims", async () => {
    const h = await seeded();
    await h.ui.rpc("deleteAccount", { id: h.ids.Dropbox! });
    const { section } = await open(h, "en");
    await within(section).findByText("Dropbox");
    expect(within(section).getByRole("button", { name: "Remove Dropbox from list" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Remove all from list…" })).toBeTruthy();
    expect(within(section).getByText("30 days")).toBeTruthy();
    expect(section.textContent).not.toMatch(/for good|permanent|undone/i);
  });
});
