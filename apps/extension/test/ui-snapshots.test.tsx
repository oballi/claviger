// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { createRpcClient } from "../src/rpc/client";
import { handleRpcMessage } from "../src/rpc/server";
import type { UiPlatform } from "../src/ui/platform";
import { BackupScreen } from "../src/ui/manage/BackupScreen";
import { CorruptScreen } from "../src/ui/manage/CorruptScreen";
import { CodesScreen } from "../src/ui/popup/CodesScreen";
import { harness, renderUi } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const B = "otpauth://totp/Beta:b@x?secret=JBSWY3DPEHPK3PXQ&issuer=Beta";
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
    await user.click(await screen.findByRole("button", { name: "Geri yükle" }));
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getAllByRole("button", { name: "Geri yükle" }).at(-1)!);
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
    await user.click(await screen.findByRole("button", { name: "Geri yükle" }));
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getAllByRole("button", { name: "Geri yükle" }).at(-1)!);
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
      expect(screen.getAllByRole("button", { name: "Geri yükle" }).length).toBeGreaterThan(1),
    );
    const rows = screen.getAllByRole("button", { name: "Geri yükle" });
    await user.click(rows[0]!);
    expect(screen.getAllByLabelText("Ana parola")).toHaveLength(1);
    await user.click(screen.getAllByRole("button", { name: "Geri yükle" })[1]!);
    expect(screen.getAllByLabelText("Ana parola")).toHaveLength(1);
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
    await user.click(await screen.findByRole("button", { name: "Geri yükle" }));
    const old = await screen.findByLabelText("Bu kopyanın parolası");
    await user.type(old, "wrong old password");
    await user.type(screen.getByLabelText("Ana parola"), NEW_PASSWORD);
    await user.click(screen.getAllByRole("button", { name: "Geri yükle" }).at(-1)!);
    await screen.findByText("Bu kopyanın parolası yanlış.");
    await user.clear(old);
    await user.type(old, PASSWORD);
    await user.type(screen.getByLabelText("Ana parola"), NEW_PASSWORD);
    await user.click(screen.getAllByRole("button", { name: "Geri yükle" }).at(-1)!);
    await screen.findByText("1 hesap eklendi, 0 zaten vardı.");
    expect((await fresh.listAccounts()).accounts).toHaveLength(1);
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

  it("warns when the vault is synced", async () => {
    const h = await harness();
    const view = renderUi(<CorruptScreen storageArea="sync" onDone={() => {}} />, h.ui);
    expect(within(view.container).getByText(/eşitleniyor/)).toBeTruthy();
  });
});
