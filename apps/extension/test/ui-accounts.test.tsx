// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountEditor, AccountsScreen } from "@otp-vault/ui/manage";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";

async function seeded() {
  const h = await harness();
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub&algorithm=SHA256&digits=8&period=60`,
    sourceUrl: "https://github.com",
  });
  await h.ui.rpc("addAccountManual", {
    draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "Bank", label: "ali" },
  });
  await h.ui.rpc("addAccountManual", { draft: { secret: "MFRGGZDFMZTWQ2LK", issuer: "Deno" } });
  return h;
}

async function open(h: Harness) {
  const onChanged = vi.fn();
  renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={onChanged} />, h.ui);
  await screen.findByText("GitHub");
  return onChanged;
}

const handleOf = async (issuer: string) =>
  within(await screen.findByText(issuer).then((n) => n.closest("tr")!)).getByTestId("drag-handle");

const names = async (h: Harness) =>
  (await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer);

describe("AccountsScreen", () => {
  it("lays out the accounts table without a minimum width or horizontal scroll class", async () => {
    const h = await seeded();
    await open(h);
    const table = screen.getByRole("table");
    expect(table.className).not.toContain("min-w-");
    expect(table.className).toContain("table-fixed");
    expect(table.closest(".grid")!.className).toContain("lg:grid-cols-[minmax(0,1fr)_300px]");
  });

  it("truncates long cells and exposes the full text in a title", async () => {
    const h = await seeded();
    const long = "Çok uzun bir servis adı ".repeat(8).trim();
    const site = "https://" + "alt-alan-adi-cok-uzun.".repeat(5) + "example.com";
    await h.ui.rpc("addAccountUri", {
      uri: `otpauth://totp/${encodeURIComponent(long)}:me?secret=GEZDGNBVGY3TQOJR&issuer=${encodeURIComponent(long)}`,
      sourceUrl: site,
    });
    await open(h);
    const row = screen.getByText(long).closest("tr")!;
    expect(screen.getByText(long).className).toContain("truncate");
    expect(screen.getByText(long).getAttribute("title")).toBe(long);
    const cells = within(row).getAllByRole("cell");
    for (const i of [2, 3, 4]) expect(cells[i]!.className).toContain("truncate");
    expect(cells[4]!.getAttribute("title")).toBe(cells[4]!.textContent);
  });

  it("keeps the Edit link reachable: nowrap in a 96px column", async () => {
    const h = await seeded();
    await open(h);
    const row = screen.getByText("GitHub").closest("tr")!;
    const cell = within(row).getAllByRole("cell").at(-1)!;
    expect(cell.className).toContain("whitespace-nowrap");
    expect(cell.className).toContain("text-right");
    expect(cell.className).toContain("pr-1");
    const cols = screen.getByRole("table").querySelectorAll("col");
    expect((cols[cols.length - 1] as HTMLElement).style.width).toBe("96px");
    expect((cols[0] as HTMLElement).style.width).toBe("32px");
  });

  it("lists accounts with linked sites, types and the summary strip", async () => {
    const h = await seeded();
    await open(h);
    expect(screen.getByRole("heading", { name: "Hesaplar." }).parentElement?.textContent).toContain(
      "3",
    );
    const row = screen.getByText("GitHub").closest("tr")!;
    expect(within(row).getByText("github.com")).toBeTruthy();
    expect(within(row).getByText("TOTP")).toBeTruthy();
    expect(within(screen.getByText("Bank").closest("tr")!).getByText("bağlı değil")).toBeTruthy();
    expect(screen.getByText("Tarayıcı kapanınca")).toBeTruthy();
    expect(screen.getByText("Yalnızca bu cihaz")).toBeTruthy();
    expect(screen.getByText("Henüz yedek alınmadı")).toBeTruthy();
  });

  it("filters by service, account or site", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.type(screen.getByRole("searchbox", { name: "Hesap ara" }), "github.com");
    expect(screen.queryByText("Bank")).toBeNull();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Hesap ara" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Hesap ara" }), "zzz");
    expect(screen.getByText("Aramana uyan hesap yok.")).toBeTruthy();
  });

  it("adds an account from a dialog", async () => {
    const h = await harness();
    const onChanged = vi.fn();
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={onChanged} />, h.ui);
    expect(await screen.findByText("Henüz hesap yok.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Hesap ekle" }));
    const dialog = screen.getByRole("dialog", { name: "Hesap ekle." });
    await userEvent.type(
      within(dialog).getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.type(within(dialog).getByLabelText("Servis"), "Acme");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hesabı ekle" }));
    expect(await screen.findByText("Acme eklendi")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("edits issuer, label and linked sites, and shows algorithm, digits and period", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    const dialog = screen.getByRole("dialog", { name: "GitHub" });
    expect(within(dialog).getByText("SHA256")).toBeTruthy();
    expect(within(dialog).getByText("8")).toBeTruthy();
    expect(within(dialog).getByText("60 sn")).toBeTruthy();
    const label = within(dialog).getByLabelText("Hesap");
    await userEvent.clear(label);
    await userEvent.type(label, "me@work");
    const issuer = within(dialog).getByLabelText("Servis");
    await userEvent.clear(issuer);
    await userEvent.type(issuer, "GitHub Work");
    const sites = within(dialog).getByLabelText("Siteler");
    await userEvent.clear(sites);
    await userEvent.type(sites, "login.github.com, gitlab.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText("GitHub Work kaydedildi.")).toBeTruthy();
    expect((await h.ui.rpc("listAccounts", {})).accounts[0]).toMatchObject({
      issuer: "GitHub Work",
      label: "me@work",
      domains: ["github.com", "gitlab.com"],
    });
  });

  it("pins and reorders within the same group", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /Bank.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yukarı taşı" }));
    await vi.waitFor(async () => expect(await names(h)).toEqual(["Bank", "GitHub", "Deno"]));
    await screen.findByText("Bank taşındı.");
    await userEvent.click(screen.getByRole("button", { name: /Deno.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sabitle" }));
    await screen.findByText("Deno sabitlendi.");
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Yukarı taşı" })).toHaveProperty("disabled", true),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Aşağı taşı" })).toHaveProperty("disabled", true),
    );
  });

  it("reorders by drag and drop within a group", async () => {
    const h = await harness();
    const secrets = ["JBSWY3DPEHPK3PXA", "JBSWY3DPEHPK3PXB", "JBSWY3DPEHPK3PXC"];
    for (const [i, issuer] of ["A", "B", "C"].entries())
      await h.ui.rpc("addAccountManual", { draft: { secret: secrets[i]!, issuer } });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    const handle = await handleOf("A");
    const rowC = screen.getByText("C").closest("tr")!;
    fireEvent.dragStart(handle);
    fireEvent.dragOver(rowC);
    fireEvent.drop(rowC);
    await vi.waitFor(async () => expect(await names(h)).toEqual(["B", "C", "A"]));
    await screen.findByText("A taşındı.");
  });

  it("drags upward, ignores cross-group hover and resets on dragend", async () => {
    const h = await seeded();
    await h.ui.rpc("setPinned", {
      id: (await h.ui.rpc("listAccounts", {})).accounts[2]!.id,
      pinned: true,
    });
    await open(h);
    const rowOf = (n: string) => screen.getByText(n).closest("tr")!;
    const bank = await handleOf("Bank");
    fireEvent.dragStart(bank);
    expect(fireEvent.dragOver(rowOf("Deno"))).toBe(true);
    expect(fireEvent.dragOver(rowOf("GitHub"))).toBe(false);
    fireEvent.dragEnd(bank);
    fireEvent.drop(rowOf("GitHub"));
    await new Promise((r) => setTimeout(r, 50));
    expect(await names(h)).toEqual(["GitHub", "Bank", "Deno"]);
    fireEvent.dragStart(await handleOf("Bank"));
    fireEvent.drop(rowOf("GitHub"));
    await vi.waitFor(async () => expect(await names(h)).toEqual(["Bank", "GitHub", "Deno"]));
  });

  it("shows a drop error in a healthy vault", async () => {
    const h = await seeded();
    const failing = {
      ...h.ui,
      rpc: (async (type: string, payload: unknown) => {
        if (type === "reorder") throw new Error("boom");
        return h.ui.rpc(type as never, payload as never);
      }) as typeof h.ui.rpc,
    };
    renderUi(
      <AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />,
      failing,
    );
    const handle = await handleOf("GitHub");
    fireEvent.dragStart(handle);
    fireEvent.drop(screen.getByText("Deno").closest("tr")!);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("does not reorder on drop while searching", async () => {
    const h = await seeded();
    await open(h);
    const handle = await handleOf("GitHub");
    fireEvent.dragStart(handle);
    await userEvent.type(screen.getByRole("searchbox", { name: "Hesap ara" }), "e");
    fireEvent.drop(screen.getByText("Deno").closest("tr")!);
    await new Promise((r) => setTimeout(r, 50));
    expect(await names(h)).toEqual(["GitHub", "Bank", "Deno"]);
  });

  it("keeps focus in the dialog when the focused move button becomes disabled", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /Bank.*hesabını düzenle/ }));
    const up = screen.getByRole("button", { name: "Yukarı taşı" });
    up.focus();
    await userEvent.click(up);
    await screen.findByText("Bank taşındı.");
    await vi.waitFor(() => expect(up).toHaveProperty("disabled", true));
    await vi.waitFor(() => {
      const dialog = screen.getByRole("dialog", { name: "Bank" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
      expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("hides drag handles while searching", async () => {
    const h = await seeded();
    await open(h);
    expect(screen.getAllByTestId("drag-handle")).toHaveLength(3);
    await userEvent.type(screen.getByRole("searchbox", { name: "Hesap ara" }), "bank");
    expect(screen.queryAllByTestId("drag-handle")).toHaveLength(0);
  });

  it("keeps the edit dialog open after pinning and moving", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /Bank.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yukarı taşı" }));
    await screen.findByText("Bank taşındı.");
    expect(screen.getByRole("dialog", { name: "Bank" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sabitle" }));
    await screen.findByText("Bank sabitlendi.");
    await screen.findByRole("button", { name: "Sabitlemeyi kaldır" });
    expect(screen.getByRole("dialog", { name: "Bank" })).toBeTruthy();
  });

  it("returns focus to the delete button after cancelling the delete step", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /Bank.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sil" }));
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sil" }));
  });

  it("disables moving past either end of the list", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    expect(screen.getByRole("button", { name: "Yukarı taşı" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Aşağı taşı" })).toHaveProperty("disabled", false);
    await userEvent.click(screen.getByRole("button", { name: "Kapat" }));
    await userEvent.click(screen.getByRole("button", { name: /Deno.*hesabını düzenle/ }));
    expect(screen.getByRole("button", { name: "Aşağı taşı" })).toHaveProperty("disabled", true);
  });

  it("does not report a move that did not happen", async () => {
    const h = await seeded();
    const [account] = (await h.ui.rpc("listAccounts", {})).accounts;
    const onChanged = vi.fn();
    renderUi(
      <AccountEditor
        account={account!}
        groups={[]}
        revealRequiresPassword={false}
        canMove={{ up: true, down: true }}
        onMove={async () => false}
        onClose={() => {}}
        onMoved={onChanged}
        onChanged={onChanged}
      />,
      h.ui,
    );
    await userEvent.click(screen.getByRole("button", { name: "Aşağı taşı" }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/taşındı/)).toBeNull();
  });

  it("shows accounts added elsewhere when the window regains focus or becomes visible", async () => {
    const h = await seeded();
    await open(h);
    await h.ui.rpc("addAccountManual", { draft: { secret: "NBSWY3DPFQQHO33S", issuer: "Later" } });
    expect(screen.queryByText("Later")).toBeNull();
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("Later")).toBeTruthy();
    await h.ui.rpc("addAccountManual", {
      draft: { secret: "ORSXG5BAON2HE2LO", issuer: "Visible" },
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("Visible")).toBeTruthy();
  });

  it("polls for accounts added elsewhere", async () => {
    const h = await seeded();
    renderUi(
      <AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={vi.fn()} pollMs={20} />,
      h.ui,
    );
    await screen.findByText("GitHub");
    await h.ui.rpc("addAccountManual", { draft: { secret: "KRUGKIDROVUWG2ZA", issuer: "Polled" } });
    expect(await screen.findByText("Polled")).toBeTruthy();
  });

  it("deletes only after confirmation", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /Deno.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sil" }));
    expect(await names(h)).toContain("Deno");
    await userEvent.click(screen.getByRole("button", { name: "Evet, sil" }));
    expect(await screen.findByText("Deno silindi.")).toBeTruthy();
    expect(await names(h)).toEqual(["GitHub", "Bank"]);
  });

  it("reveals the secret and QR after the password, or directly when the setting allows", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    expect(await screen.findByRole("img", { name: "GitHub için QR kodu" })).toBeTruthy();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı kopyala" }));
    expect(h.ui.copy).toHaveBeenCalledWith(SECRET);
  });

  it("never puts the secret in the DOM or asks the service before the password is confirmed", async () => {
    const h = await seeded();
    const spy = vi.spyOn(h.service, "revealSecret");
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    const text = () => document.body.innerHTML.replace(/\s/g, "");
    expect(text()).not.toContain(SECRET);
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    await screen.findByLabelText("Ana parola");
    expect(text()).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain("JBSW Y3DP");
    expect(screen.queryByRole("img", { name: "GitHub için QR kodu" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Ana parola"), "wrong password!");
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    await within(screen.getByRole("dialog")).findByText("Parola yanlış.");
    expect(text()).not.toContain(SECRET);
    expect(spy).not.toHaveBeenCalled();
  });

  it("forgets a revealed secret when the dialog is closed and reopened, and reveal never copies", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    await screen.findByText("JBSW Y3DP EHPK 3PXP");
    expect(h.ui.copy).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
    expect(screen.queryByRole("img", { name: "GitHub için QR kodu" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(await screen.findByLabelText("Ana parola")).toBeTruthy();
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
  });

  it("searches by issuer and by label", async () => {
    const h = await seeded();
    await open(h);
    const box = screen.getByRole("searchbox", { name: "Hesap ara" });
    await userEvent.type(box, "git");
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.queryByText("Bank")).toBeNull();
    // "Deno" has no linked site, so only the issuer can match.
    await userEvent.clear(box);
    await userEvent.type(box, "den");
    expect(screen.getByText("Deno")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "ali");
    expect(screen.getByText("Bank")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("styles a missing backup as a warning and shows the date once one exists", async () => {
    const h = await seeded();
    const { unmount } = renderUi(
      <AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />,
      h.ui,
    );
    await screen.findByText("GitHub");
    expect(screen.getByText("Henüz yedek alınmadı").className).toContain("text-warn");
    unmount();
    const state = { ...(await h.ui.rpc("getState", {})), lastBackupAt: Date.UTC(2026, 2, 5, 12) };
    renderUi(<AccountsScreen state={state} onChanged={() => {}} />, h.ui);
    await screen.findByText("GitHub");
    expect(screen.queryByText("Henüz yedek alınmadı")).toBeNull();
    const dd = screen.getByText("Son yedek").nextElementSibling!;
    expect(dd.textContent).toMatch(/2026/);
    expect(dd.className).not.toContain("text-warn");
  });

  it("falls back to the text secret when the QR does not fit", async () => {
    const h = await harness();
    const long = "\u015f".repeat(512);
    await h.ui.rpc("addAccountManual", { draft: { secret: SECRET, issuer: long, label: long } });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /hesabını düzenle$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    expect(screen.getByText(/QR'a sığmayacak kadar uzun/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("names the edit button after service and account, and labels types", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountManual", {
      draft: { secret: SECRET, issuer: "Google", label: "ali@x.com" },
    });
    await h.ui.rpc("addAccountManual", {
      draft: { secret: "MFRGGZDFMZTWQ2LK", issuer: "Google", label: "veli@x.com" },
    });
    await h.ui.rpc("addAccountUri", {
      uri: `otpauth://steam/Valve:gabe?secret=GEZDGNBVGY3TQOJQ&issuer=Valve`,
    });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    expect(
      await screen.findByRole("button", { name: "Google (ali@x.com) hesabını düzenle" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Google (veli@x.com) hesabını düzenle" }),
    ).toBeTruthy();
    expect(within(screen.getByText("Valve").closest("tr")!).getByText("Steam")).toBeTruthy();
  });

  it("falls back to the unnamed text for an account without issuer or label", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountManual", { draft: { secret: SECRET } });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    expect(await screen.findByRole("button", { name: "Hesap hesabını düzenle" })).toBeTruthy();
  });

  it("uses fixed table columns", async () => {
    const h = await seeded();
    await open(h);
    const table = screen.getByRole("table");
    expect(table.className).toContain("table-fixed");
    expect(table.querySelectorAll("colgroup col")).toHaveLength(7);
  });

  it("reveals without a password when the user turned that off", async () => {
    const h = await seeded();
    const { token } = await h.ui.rpc("reauth", { password: PASSWORD });
    await h.ui.rpc("setRevealRequiresPassword", { token, value: false });
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    expect(screen.queryByLabelText("Ana parola")).toBeNull();
  });

  it("falls back to the password when the service still requires it", async () => {
    const h = await seeded();
    const state = { ...(await h.ui.rpc("getState", {})), revealRequiresPassword: false };
    renderUi(<AccountsScreen state={state} onChanged={() => {}} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(await screen.findByLabelText("Ana parola")).toBeTruthy();
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
  });

  it("repairs a damaged index and deletes unreadable entries after confirmation", async () => {
    const h = await seeded();
    h.p.local.data.set("vault:acct:broken", "garbage");
    h.p.local.data.set("vault:index", "garbage");
    await open(h);
    const box = screen.getByRole("region", { name: "Bakım gerekiyor." });
    await userEvent.click(within(box).getByRole("button", { name: "Hesap sırasını onar" }));
    await screen.findByText("Hesap sırası onarıldı.");
    await userEvent.click(within(box).getByRole("button", { name: "broken kaydını sil" }));
    await userEvent.click(within(box).getByRole("button", { name: "Evet, sil" }));
    await screen.findByText("Okunamayan kayıt silindi.");
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "Bakım gerekiyor." })).toBeNull(),
    );
    expect(await h.ui.rpc("listAccounts", {})).toMatchObject({
      unreadable: [],
      indexDamaged: false,
    });
  });
});
