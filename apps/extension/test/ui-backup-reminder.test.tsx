// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BackupScreen } from "@claviger/ui/manage";
import { ManageApp } from "@claviger/ui/manage";
import { CodesScreen } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const DAY = 86_400_000;

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

async function dueHarness() {
  const h = await harness();
  await h.service.addAccount({ uri: A });
  await h.service.getState();
  h.p.clock.advance(31 * DAY);
  return h;
}

describe("backup reminder notice", () => {
  it("shows in the popup, links to Backup and can be dismissed", async () => {
    const h = await dueHarness();
    const state = await h.service.getState();
    renderUi(<CodesScreen state={state} pollMs={0} onLocked={() => {}} />, h.ui);
    const note = await screen.findByRole("status", { name: "Yedek hatırlatması" });
    expect(note.textContent).toContain("Henüz yedek almadın.");
    await userEvent.click(within(note).getByRole("button", { name: "Yedekle" }));
    expect(h.ui.openManage).toHaveBeenCalledWith("backup");
    await userEvent.click(
      within(note).getByRole("button", { name: "Yedek hatırlatmasını 7 gün gizle" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Yedek hatırlatması" })).toBeNull(),
    );
    expect((await h.service.getState()).backupReminder).toBeNull();
  });

  it("says how long ago the last backup was", async () => {
    const h = await harness();
    await h.service.addAccount({ uri: A });
    const { token } = await h.service.reauth("correct horse battery");
    await h.service.exportVault(token, "otpauth");
    h.p.clock.advance(45 * DAY);
    renderUi(
      <CodesScreen state={await h.service.getState()} pollMs={0} onLocked={() => {}} />,
      h.ui,
    );
    expect(
      (await screen.findByRole("status", { name: "Yedek hatırlatması" })).textContent,
    ).toContain("Son yedeğin 45 gün önce alındı.");
  });

  it("is absent when nothing is due", async () => {
    const h = await harness();
    await h.service.addAccount({ uri: A });
    renderUi(
      <CodesScreen state={await h.service.getState()} pollMs={0} onLocked={() => {}} />,
      h.ui,
    );
    await screen.findByText("Acme");
    expect(screen.queryByRole("status", { name: "Yedek hatırlatması" })).toBeNull();
  });

  it("shows on the manage Accounts page but not on Backup", async () => {
    const h = await dueHarness();
    window.location.hash = "#/accounts";
    renderUi(<ManageApp pollMs={10} />, h.ui);
    const note = await screen.findByRole("status", { name: "Yedek hatırlatması" });
    await userEvent.click(within(note).getByRole("button", { name: "Yedekle" }));
    expect(h.ui.openManage).toHaveBeenCalledWith("backup");
    cleanup();
    renderUi(
      <BackupScreen state={await h.service.getState()} onChanged={() => {}} onImport={() => {}} />,
      h.ui,
    );
    await screen.findByRole("combobox", { name: "Yedek hatırlatması" });
    expect(screen.queryByRole("status", { name: "Yedek hatırlatması" })).toBeNull();
  });

  it("the Backup page select writes the setting", async () => {
    const h = await harness();
    await h.service.addAccount({ uri: A });
    renderUi(
      <BackupScreen state={await h.service.getState()} onChanged={() => {}} onImport={() => {}} />,
      h.ui,
    );
    const select = await screen.findByRole("combobox", { name: "Yedek hatırlatması" });
    expect((select as HTMLSelectElement).value).toBe("30");
    await userEvent.selectOptions(select, "90");
    await waitFor(async () => expect((await h.service.getState()).backupReminderDays).toBe(90));
    await userEvent.selectOptions(select, "0");
    await waitFor(async () => expect((await h.service.getState()).backupReminderDays).toBe(0));
  });
});
