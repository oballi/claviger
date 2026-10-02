// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PopupApp } from "@otp-vault/ui/popup";
import { SecurityScreen } from "@otp-vault/ui/manage";
import { applyCachedTheme } from "@otp-vault/ui";
import { harness, renderUi } from "./helpers/ui";

const html = document.documentElement;
afterEach(() => {
  cleanup();
  html.removeAttribute("data-theme");
  localStorage.clear();
});

async function security(status: "unlocked" | "locked" = "unlocked") {
  const h = await harness({ status });
  const state = await h.service.getState();
  renderUi(<SecurityScreen state={state} onChanged={() => {}} />, h.ui);
  return h;
}

describe("theme", () => {
  it("defaults to system and exposes the setting while locked", async () => {
    const h = await harness({ status: "locked" });
    expect((await h.service.getState()).theme).toBe("system");
    await h.service.setTheme("dark");
    expect((await h.service.getState()).theme).toBe("dark");
  });

  it("offers a radiogroup, Koyu sets data-theme and persists across a remount", async () => {
    const h = await security();
    const group = screen.getByRole("radiogroup", { name: "Tema" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Sistem" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.setup().click(screen.getByRole("radio", { name: "Koyu" }));
    expect(html.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "Koyu" }).getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("otp-vault-theme")).toBe("dark");

    cleanup();
    html.removeAttribute("data-theme");
    localStorage.clear();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText(/./);
    await waitFor(() => expect(html.getAttribute("data-theme")).toBe("dark"));
  });

  it("themes the lock screen: the locked popup applies the stored choice", async () => {
    const h = await harness({ status: "locked" });
    await h.service.setTheme("light");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await waitFor(() => expect(html.getAttribute("data-theme")).toBe("light"));
  });

  it("Sistem removes the attribute", async () => {
    const h = await security();
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Açık" }));
    expect(html.getAttribute("data-theme")).toBe("light");
    await user.click(screen.getByRole("radio", { name: "Sistem" }));
    expect(html.hasAttribute("data-theme")).toBe(false);
    expect((await h.service.getState()).theme).toBe("system");
  });

  it("moves between radios with the arrow keys (roving tabindex)", async () => {
    await security();
    const user = userEvent.setup();
    const system = screen.getByRole("radio", { name: "Sistem" });
    expect(system.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "Açık" }).getAttribute("tabindex")).toBe("-1");
    system.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Açık" }));
    expect(html.getAttribute("data-theme")).toBe("light");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Koyu" }));
    expect(html.getAttribute("data-theme")).toBe("dark");
  });

  it("applies the cached choice synchronously and ignores junk", () => {
    localStorage.setItem("otp-vault-theme", "dark");
    applyCachedTheme();
    expect(html.getAttribute("data-theme")).toBe("dark");
    localStorage.setItem("otp-vault-theme", "<x>");
    applyCachedTheme();
    expect(html.hasAttribute("data-theme")).toBe(false);
  });

  it("shows English strings", async () => {
    const h = await harness();
    renderUi(
      <SecurityScreen state={await h.service.getState()} onChanged={() => {}} />,
      h.ui,
      "en",
    );
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeTruthy();
  });
});
