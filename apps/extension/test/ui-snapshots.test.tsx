// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { createRpcClient, RpcError } from "@otp-vault/ui/rpc-client";
import { handleRpcMessage } from "../src/rpc/server";
import type { UiPlatform } from "@otp-vault/ui";
import { BackupScreen, CorruptScreen } from "@otp-vault/ui/manage";
import { CodesScreen } from "@otp-vault/ui/popup";
import { harness, renderUi } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const B = "otpauth://totp/Beta:b@x?secret=JBSWY3DPEHPK3PXQ&issuer=Beta";
const NOTE = "Yalnızca eksik hesaplar eklenir; hiçbir şey silinmez.";
const ROW = /kopyasını geri yükle/;
const NEW_PASSWORD = "new password 123";

async function withCopy() {
  const h = await harness();
  const { id } = await h.service.addAccount({ uri: A });
  h.p.clock.advance(1000);
  await h.service.deleteAccount(id);
  return h;
}

async function backup(h: Awaited<ReturnType<typeof harness>>, ui: UiPlatform = h.ui) {
  renderUi(
    <BackupScreen state={await h.service.getState()} onChanged={() => {}} onImport={() => {}} />,
    ui,
  );
}

describe("automatic copies section", () => {
  it("lists copies and restores the missing accounts", async () => {
    const h = await withCopy();
    await backup(h);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ROW }));
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Geri yükle" }));
    await screen.findByText("1 hesap eklendi, 0 zaten vardı.");
    expect(screen.queryByText(/okunamadı/)).toBeNull();
    expect((await h.service.listAccounts()).accounts).toHaveLength(1);
  });

  it("shows when there are no copies", async () => {
    const h = await harness();
    // The service takes a daily copy on first use, so stub the list.
    const rpc: UiPlatform["rpc"] = async (type, payload) =>
      type === "listSnapshots" ? ([] as never) : h.ui.rpc(type, payload);
    await backup(h, { ...h.ui, rpc });
    expect(await screen.findByText("Henüz kopya yok.")).toBeTruthy();
  });

  it("shows the unreadable count only when non-zero", async () => {
    const h = await withCopy();
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      const r = await h.ui.rpc(type, payload);
      return (type === "restoreSnapshot" ? { ...(r as object), unreadable: 2 } : r) as never;
    };
    await backup(h, { ...h.ui, rpc });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ROW }));
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Geri yükle" }));
    await screen.findByText("1 hesap eklendi, 0 zaten vardı. 2 hesap okunamadı.");
  });

  it("opens one restore panel at a time", async () => {
    const h = await withCopy();
    await h.service.addAccount({ uri: B });
    h.p.clock.advance(1000);
    const { accounts } = await h.service.listAccounts();
    await h.service.deleteAccount(accounts[0]!.id);
    await backup(h);
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: ROW }).length).toBeGreaterThan(1),
    );
    const [first, second] = screen.getAllByRole("button", { name: ROW });
    await user.click(first!);
    expect(first!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    await user.click(second!);
    expect(first!.getAttribute("aria-expanded")).toBe("false");
    expect(second!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    expect(screen.getAllByLabelText("Ana parola")).toHaveLength(1);
  });

  it("returns focus to the row toggle, calls onChanged and reloads after a restore", async () => {
    const h = await withCopy();
    let changed = 0;
    let lists = 0;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "listSnapshots") lists++;
      return h.ui.rpc(type, payload);
    };
    renderUi(
      <BackupScreen
        state={await h.service.getState()}
        onChanged={() => changed++}
        onImport={() => {}}
      />,
      { ...h.ui, rpc },
    );
    const user = userEvent.setup();
    const toggle = await screen.findByRole("button", { name: ROW });
    const before = lists;
    await user.click(toggle);
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Geri yükle" }));
    await screen.findByText("1 hesap eklendi, 0 zaten vardı.");
    expect(changed).toBe(1);
    await waitFor(() => expect(lists).toBeGreaterThan(before));
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it("reveals and focuses the password field on snapshot-password-required", async () => {
    const h = await withCopy();
    let first = true;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "restoreSnapshot" && first) {
        first = false;
        throw new RpcError("snapshot-password-required", "x");
      }
      return h.ui.rpc(type, payload);
    };
    await backup(h, { ...h.ui, rpc });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ROW }));
    expect(screen.queryByLabelText("Bu kopyanın parolası")).toBeNull();
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Geri yükle" }));
    const field = await screen.findByLabelText("Bu kopyanın parolası");
    expect(document.activeElement).toBe(field);
    await screen.findByText("Bu kopya başka bir kasaya ait; parolasını gir.");
  });

  it("asks for the old password when the copy belongs to another vault", async () => {
    const h = await withCopy();
    await h.p.local.set({ "vault:header": { format: 1, nope: true } });
    await h.service.quarantineVault();
    const fresh = new VaultService(h.p);
    await fresh.setup({
      password: NEW_PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    const ctx = { extensionId: "ext-id", extensionOrigin: "chrome-extension://ext-id/" };
    const sender = { id: "ext-id", url: "chrome-extension://ext-id/popup.html" };
    const ui: UiPlatform = {
      ...h.ui,
      rpc: createRpcClient((m) => handleRpcMessage(fresh, m, sender, ctx)),
    };
    renderUi(
      <BackupScreen state={await fresh.getState()} onChanged={() => {}} onImport={() => {}} />,
      ui,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ROW }));
    const old = await screen.findByLabelText("Bu kopyanın parolası");
    await user.type(old, "wrong old password");
    await user.type(screen.getByLabelText("Ana parola"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Geri yükle" }));
    await screen.findByText("Bu kopyanın parolası yanlış.");
    await user.clear(old);
    await user.type(old, PASSWORD);
    await user.type(screen.getByLabelText("Ana parola"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Geri yükle" }));
    await screen.findByText("1 hesap eklendi, 0 zaten vardı.");
    expect((await fresh.listAccounts()).accounts).toHaveLength(1);
  });

  it("blocks submit while the old password is empty and the field is shown", async () => {
    const h = await withCopy();
    await h.p.local.set({ "vault:header": { format: 1, nope: true } });
    await h.service.quarantineVault();
    const fresh = new VaultService(h.p);
    await fresh.setup({
      password: NEW_PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    let reauths = 0;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "reauth") reauths++;
      return createRpcClient((m) =>
        handleRpcMessage(
          fresh,
          m,
          { id: "ext-id", url: "chrome-extension://ext-id/popup.html" },
          { extensionId: "ext-id", extensionOrigin: "chrome-extension://ext-id/" },
        ),
      )(type, payload);
    };
    renderUi(
      <BackupScreen state={await fresh.getState()} onChanged={() => {}} onImport={() => {}} />,
      { ...h.ui, rpc },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ROW }));
    await screen.findByLabelText("Bu kopyanın parolası");
    await user.type(screen.getByLabelText("Ana parola"), NEW_PASSWORD);
    const submit = screen.getByRole("button", { name: "Geri yükle" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Ana parola"), "{Enter}");
    expect(reauths).toBe(0);
    await user.type(screen.getByLabelText("Bu kopyanın parolası"), "x");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the result region in the accessibility tree while empty", async () => {
    const h = await withCopy();
    await backup(h, h.ui);
    await screen.findByRole("button", { name: ROW });
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((el) => el.className.includes("min-h-4") && el.textContent === "")).toBe(
      true,
    );
  });
});

describe("empty vault offer", () => {
  it("links the popup's empty list to the backup page", async () => {
    const h = await withCopy();
    const state = await h.service.getState();
    expect(state.snapshotOffer).not.toBeNull();
    renderUi(<CodesScreen state={state} pollMs={0} onLocked={() => {}} />, h.ui);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Otomatik kopyadan geri yükle (1 hesap)" }),
    );
    expect(h.ui.openManage).toHaveBeenCalledWith("backup");
  });

  it("shows no offer without a copy", async () => {
    const h = await harness();
    renderUi(
      <CodesScreen state={await h.service.getState()} pollMs={0} onLocked={() => {}} />,
      h.ui,
    );
    await screen.findByText("Henüz hesap yok.", { exact: false });
    expect(screen.queryByRole("button", { name: /Otomatik kopyadan/ })).toBeNull();
  });
});

describe("corrupt vault", () => {
  it("moves the data aside only after the typed confirmation", async () => {
    const h = await harness();
    await h.p.local.set({ "vault:header": { format: 1, broken: true } });
    let done = 0;
    renderUi(<CorruptScreen storageArea="local" onDone={() => done++} />, h.ui);
    const user = userEvent.setup();
    const submit = screen.getByRole("button", { name: "Kenara al ve yeni kasa kur" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Onaylamak için KENARA AL yaz"), "KENARA AL");
    await user.click(submit);
    await waitFor(() => expect(done).toBe(1));
    expect((await h.service.getState()).status).toBe("no-vault");
  });

  it("rejects a lowercase or partial confirmation", async () => {
    const h = await harness();
    renderUi(<CorruptScreen storageArea="local" onDone={() => {}} />, h.ui);
    const user = userEvent.setup();
    const submit = screen.getByRole("button", { name: "Kenara al ve yeni kasa kur" });
    const field = screen.getByLabelText("Onaylamak için KENARA AL yaz");
    await user.type(field, "kenara al");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.clear(field);
    await user.type(field, "KENARA");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows no sync warning for local storage", async () => {
    const h = await harness();
    renderUi(<CorruptScreen storageArea="local" onDone={() => {}} />, h.ui);
    expect(screen.queryByText(/eşitleniyor/)).toBeNull();
  });

  it("warns when the vault is synced", async () => {
    const h = await harness();
    const view = renderUi(<CorruptScreen storageArea="sync" onDone={() => {}} />, h.ui);
    expect(within(view.container).getByText(/eşitleniyor/)).toBeTruthy();
  });
});
