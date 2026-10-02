// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";

async function popupOn(tabUrl: string) {
  const h = await harness({ tabUrl });
  const linked = { sourceUrl: "https://acme.com" };
  await h.service.addAccount(
    { uri: `otpauth://totp/Acme:me?secret=${SECRET}&issuer=Acme` },
    linked,
  );
  await h.service.addAccount(
    { uri: "otpauth://totp/Acme2:me?secret=GEZDGNBVGY3TQOJQ&issuer=Acme2" },
    linked,
  );
  await h.service.addAccount({
    uri: "otpauth://totp/Zed:zed@acme.com?secret=NBSWY3DPEB3W64TM&issuer=Zed",
  });
  await h.service.addAccount(
    { uri: "otpauth://totp/Ac.me:other?secret=MFRGGZDFMZTWQ2LK&issuer=Ac.me" },
    { allowSameName: true },
  );
  return h;
}

function open(h: Awaited<ReturnType<typeof harness>>) {
  renderUi(<PopupApp pollMs={0} />, h.ui);
}

describe("popup site section", () => {
  it("has no fill button for a linked account", async () => {
    open(await popupOn("https://acme.com/login"));
    await screen.findByText("Bu site");
    expect(screen.queryByRole("button", { name: /sayfaya doldur/ })).toBeNull();
    expect(screen.queryByText("Doldur")).toBeNull();
  });

  it("lists only accounts linked to the site, all of them", async () => {
    open(await popupOn("https://acme.com/login"));
    const site = (await screen.findByText("Bu site")).closest("section")!;
    expect(within(site).getByText("Acme")).toBeTruthy();
    expect(within(site).getByText("Acme2")).toBeTruthy();
    expect(within(site).queryByText("Zed")).toBeNull();
    expect(within(site).queryByText("Ac.me")).toBeNull();
    expect(screen.getByText("Zed")).toBeTruthy();
    expect(screen.getByText("Ac.me")).toBeTruthy();
    expect(screen.queryByText("olası eşleşme")).toBeNull();
    expect(screen.queryByText("son kullanılan")).toBeNull();
  });

  it("shows no site section when nothing is linked", async () => {
    open(await popupOn("https://nolink.example/"));
    await screen.findByText("Acme");
    expect(screen.queryByText("Bu site")).toBeNull();
  });

  it("links the site from the row menu and moves the account under this site", async () => {
    open(await popupOn("https://zed.com/login"));
    expect(screen.queryByText("Bu site")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /Zed.*(işlemler|menü)/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Bu siteye bağla/ }));
    expect(await screen.findByText("Site hesaba bağlandı")).toBeTruthy();
    const site = (await screen.findByText("Bu site")).closest("section")!;
    expect(within(site).getByText("Zed")).toBeTruthy();
  });
});
