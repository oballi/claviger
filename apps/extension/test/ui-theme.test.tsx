// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PopupApp } from "@claviger/ui/popup";
import { SecurityScreen } from "@claviger/ui/manage";
import { applyCachedTheme } from "@claviger/ui";
import { resolvedScheme } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const html = document.documentElement;
afterEach(() => {
  cleanup();
  html.removeAttribute("data-theme");
  localStorage.clear();
  vi.unstubAllGlobals();
});

const prefersDark = (dark: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: dark && q.includes("dark"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));

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
    expect(localStorage.getItem("claviger-theme")).toBe("dark");

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
    localStorage.setItem("claviger-theme", "dark");
    applyCachedTheme();
    expect(html.getAttribute("data-theme")).toBe("dark");
    localStorage.setItem("claviger-theme", "<x>");
    applyCachedTheme();
    expect(html.hasAttribute("data-theme")).toBe(false);
  });

  it("reads the legacy cache key once and migrates it", () => {
    localStorage.setItem("otp-vault-theme", "dark");
    applyCachedTheme();
    expect(html.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("claviger-theme")).toBe("dark");
    expect(localStorage.getItem("otp-vault-theme")).toBeNull();
  });

  it("drops an invalid legacy value without migrating it", () => {
    localStorage.setItem("otp-vault-theme", "<x>");
    applyCachedTheme();
    expect(html.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("claviger-theme")).toBeNull();
    expect(localStorage.getItem("otp-vault-theme")).toBeNull();
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

describe("popup theme toggle", () => {
  it("shows the moon and offers dark when the resolved scheme is light", async () => {
    prefersDark(false);
    const h = await harness();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    expect(await screen.findByRole("button", { name: "Koyu temaya geç" })).toBeTruthy();
  });

  it("from system it switches to the opposite of the resolved scheme and stores it", async () => {
    prefersDark(true);
    const h = await harness();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Açık temaya geç" }));
    expect(html.getAttribute("data-theme")).toBe("light");
    expect(await screen.findByRole("button", { name: "Koyu temaya geç" })).toBeTruthy();
    await waitFor(async () => expect((await h.service.getState()).theme).toBe("light"));
  });

  it("toggles light and dark on every click and persists each choice", async () => {
    prefersDark(false);
    const h = await harness();
    await h.service.setTheme("light");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Koyu temaya geç" }));
    expect(html.getAttribute("data-theme")).toBe("dark");
    await waitFor(async () => expect((await h.service.getState()).theme).toBe("dark"));
    await userEvent.click(await screen.findByRole("button", { name: "Açık temaya geç" }));
    expect(html.getAttribute("data-theme")).toBe("light");
    await waitFor(async () => expect((await h.service.getState()).theme).toBe("light"));
  });

  it("reverts the theme and shows an error when the RPC fails", async () => {
    prefersDark(false);
    const h = await harness();
    await h.service.setTheme("light");
    const real = h.ui.rpc;
    h.ui.rpc = ((type: string, ...rest: unknown[]) =>
      type === "setTheme"
        ? Promise.reject(new Error("boom"))
        : (real as (...a: unknown[]) => unknown)(type, ...rest)) as typeof real;
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "Koyu temaya geç" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(html.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Koyu temaya geç" })).toBeTruthy();
  });

  it("keeps the Settings picker: system option still exists", async () => {
    await security();
    expect(screen.getByRole("radio", { name: "Sistem" })).toBeTruthy();
  });

  it("resolvedScheme falls back to light without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(resolvedScheme("system")).toBe("light");
    expect(resolvedScheme("dark")).toBe("dark");
  });
});
