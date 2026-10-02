// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupScreen } from "@claviger/ui/manage";
import { harness, renderUi } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

const base32 = (n: number) =>
  "JBSWY3DPEHPK" +
  n
    .toString(6)
    .replace(/\d/g, (d) => "ABCDEF"[Number(d)]!)
    .padStart(4, "A");

async function open(count = 12) {
  const h = await harness();
  for (let i = 0; i < count; i++)
    await h.ui.rpc("addAccountUri", {
      uri: `otpauth://totp/Site${i}:user${i}@example.com?secret=${base32(i + 1)}&issuer=Site${i}`,
    });
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/Seven:me?secret=${base32(99)}&issuer=Seven&digits=7`,
  });
  renderUi(
    <BackupScreen
      state={await h.ui.rpc("getState", {})}
      onChanged={() => {}}
      onImport={() => {}}
    />,
    h.ui,
  );
  return h;
}

const section = () => screen.getByRole("region", { name: /Telefona aktar/ });

async function toViewer(user: Pick<typeof userEvent, "click" | "type"> = userEvent) {
  await user.click(within(section()).getByRole("button", { name: "Hesapları seç…" }));
  await within(section()).findAllByRole("checkbox");
  await user.type(within(section()).getByLabelText("Ana parola"), PASSWORD);
  await user.click(within(section()).getByRole("button", { name: "QR'ları göster" }));
  await screen.findByText(/^QR 1 \/ \d+$/);
}

describe("phone transfer", () => {
  it("selects accounts, re-authenticates, then pages through the QR codes", async () => {
    await open();
    await toViewer();
    const total = Number(/\/ (\d+)$/.exec(screen.getByText(/^QR 1 \/ \d+$/).textContent!)![1]);
    expect(total).toBeGreaterThan(1);
    expect(screen.getByRole("img", { name: `Taşıma QR'ı 1 / ${total}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Önceki" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "Sonraki" }));
    expect(screen.getByText(`QR 2 / ${total}`)).toBeTruthy();
    expect(
      screen.getByText(/Buradaki hesapları silmeden önce telefonda bir kodu kontrol edin/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(base32(1));
  });

  it("lists the accounts that could not be moved, with the reason", async () => {
    await open();
    await toViewer();
    expect(screen.getByText("Taşınamayanlar")).toBeTruthy();
    expect(screen.getByText("Seven: me")).toBeTruthy();
    expect(screen.getByText(/7 haneli kodlar desteklenmez/)).toBeTruthy();
  });

  it("is not a backup", async () => {
    const h = await open(2);
    await toViewer();
    expect((await h.ui.rpc("getState", {})).lastBackupAt).toBeNull();
  });

  it("only exports the ticked accounts and needs at least one", async () => {
    const h = await open(2);
    const spy = vi.spyOn(h.service, "exportMigration");
    await userEvent.click(within(section()).getByRole("button", { name: "Hesapları seç…" }));
    await userEvent.click(await within(section()).findByRole("checkbox", { name: /Site0/ }));
    await userEvent.click(within(section()).getByRole("checkbox", { name: /Site1/ }));
    await userEvent.click(within(section()).getByRole("checkbox", { name: /Seven/ }));
    expect(within(section()).queryByLabelText("Ana parola")).toBeNull();
    await userEvent.click(within(section()).getByRole("checkbox", { name: /Site1/ }));
    await userEvent.type(within(section()).getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(within(section()).getByRole("button", { name: "QR'ları göster" }));
    await screen.findByText(/^QR 1 \/ 1$/);
    expect(spy.mock.calls[0]![1]).toHaveLength(1);
  });

  it("hides on request, after 120 s and when the page is hidden", async () => {
    await open(2);
    await toViewer();
    await userEvent.click(screen.getByRole("button", { name: "Gizle" }));
    expect(screen.queryByText(/^QR 1 \//)).toBeNull();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await toViewer(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
    expect(screen.getByRole("timer").textContent).toBe("120 sn içinde gizlenir");
    await act(() => vi.advanceTimersByTimeAsync(121_000));
    expect(screen.queryByText(/^QR 1 \//)).toBeNull();
  });

  it("hides at once when the page becomes hidden", async () => {
    await open(2);
    await toViewer();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByText(/^QR 1 \//)).toBeNull();
  });
});
