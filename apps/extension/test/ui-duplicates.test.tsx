// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsScreen } from "@claviger/ui/manage";
import { describe, expect, it, vi } from "vitest";
import { plant } from "./helpers/duplicates";
import { harness, renderUi, type Harness } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";
const OTHER = "GEZDGNBVGY3TQOJQ";

async function open(h: Harness, locale: "tr" | "en" = "tr") {
  const onChanged = vi.fn();
  renderUi(
    <AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={onChanged} pollMs={0} />,
    h.ui,
    locale,
  );
  return { onChanged };
}

async function withExactCopy() {
  const h = await harness();
  const a = await h.ui.rpc("addAccountManual", {
    draft: { secret: SECRET, issuer: "GitHub", label: "me" },
  });
  const b = await plant(h.service, a.id, { label: "" });
  return { ...h, a: a.id, b: b.id };
}

describe("manage: duplicates", () => {
  it("shows nothing when there are no duplicates", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountManual", { draft: { secret: SECRET, issuer: "GitHub" } });
    await open(h);
    await screen.findByText("GitHub");
    expect(screen.queryByRole("button", { name: "İncele" })).toBeNull();
  });

  it("offers a review line only when exact copies exist", async () => {
    const h = await withExactCopy();
    await open(h);
    expect(await screen.findByText("1 yinelenen hesap bulundu")).toBeTruthy();
  });

  it("merges with the suggested keeper, then undo restores the copy", async () => {
    const h = await withExactCopy();
    const { onChanged } = await open(h);
    await userEvent.click(await screen.findByRole("button", { name: "İncele" }));
    const dialog = await screen.findByRole("dialog", { name: "Yinelenen hesaplar" });
    expect(dialog.textContent).not.toContain(SECRET);
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole("button", { name: "Birleştir" }));
    expect(await screen.findByText(/1 kopya kaldırıldı/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect((await h.ui.rpc("listAccounts", {})).accounts).toHaveLength(1);
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Geri al" }));
    await waitFor(async () =>
      expect((await h.ui.rpc("listAccounts", {})).accounts).toHaveLength(2),
    );
    expect(await h.ui.rpc("listTrash", {})).toHaveLength(0);
  });

  it("says how many copies came back when some were purged meanwhile", async () => {
    const h = await withExactCopy();
    await plant(h.service, h.a);
    await open(h);
    await userEvent.click(await screen.findByRole("button", { name: "İncele" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Birleştir" }));
    await screen.findByText(/2 kopya kaldırıldı/);
    await h.ui.rpc("purgeTrash", { id: (await h.ui.rpc("listTrash", {}))[0]!.id });
    await userEvent.click(screen.getByRole("button", { name: "Geri al" }));
    expect(await screen.findByText(/1 \/ 2 hesap geri yüklendi/)).toBeTruthy();
  });

  it("merges into the keeper the user picked", async () => {
    const h = await withExactCopy();
    await open(h);
    await userEvent.click(await screen.findByRole("button", { name: "İncele" }));
    const dialog = await screen.findByRole("dialog");
    const radios = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    const other = radios.find((r) => !r.checked)!;
    await userEvent.click(other);
    await userEvent.click(within(dialog).getByRole("button", { name: "Birleştir" }));
    await screen.findByText(/1 kopya kaldırıldı/);
    const left = (await h.ui.rpc("listAccounts", {})).accounts[0]!;
    expect([h.a, h.b]).toContain(left.id);
    expect(left.id).toBe(other.value);
  });

  it("never offers Merge for similar accounts and explains same-secret ones", async () => {
    const h = await harness();
    const a = await h.ui.rpc("addAccountManual", {
      draft: { secret: SECRET, issuer: "GitHub", label: "me" },
    });
    await plant(h.service, a.id, { secret: OTHER });
    await plant(h.service, a.id, { digits: 8, issuer: "Zed" });
    await open(h);
    await userEvent.click(await screen.findByRole("button", { name: "İncele" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Benzer adlar, farklı anahtarlar")).toBeTruthy();
    expect(within(dialog).getByText(/Aynı anahtar, farklı ayarlar/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Birleştir" })).toBeNull();
    await userEvent.click(within(dialog).getAllByRole("button", { name: /düzenle/ })[0]!);
    expect(screen.queryByRole("dialog", { name: "Yinelenen hesaplar" })).toBeNull();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("disables keeping an HOTP copy with an older counter", async () => {
    const h = await harness();
    const a = await h.ui.rpc("addAccountManual", {
      draft: { type: "hotp", secret: SECRET, issuer: "Bank", counter: 1 },
    });
    const b = await plant(h.service, a.id, { counter: 5 });
    await open(h, "en");
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    const radios = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.find((r) => r.value === a.id)!.disabled).toBe(true);
    const keeper = radios.find((r) => r.value === b.id)!;
    expect(keeper.disabled).toBe(false);
    expect(keeper.checked).toBe(true);
    expect(within(dialog).getByText("Older counter: can't be kept")).toBeTruthy();
  });

  it("closes the dialog on Escape", async () => {
    const h = await withExactCopy();
    await open(h);
    await userEvent.click(await screen.findByRole("button", { name: "İncele" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
