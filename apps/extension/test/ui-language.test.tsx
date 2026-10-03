// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LANGUAGE_VALUES, LOCALES, readCachedLocale, resolveLocale, translate } from "@claviger/ui";
import { ManageApp } from "@claviger/ui/manage";
import { PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = "";
  document.documentElement.lang = "";
});

describe("language", () => {
  it("switches a mounted ManageApp at runtime and mirrors the choice", async () => {
    const h = await harness({ status: "locked" });
    renderUi(<ManageApp pollMs={10} />, h.ui);
    expect(await screen.findByRole("button", { name: "Kilidi aç" })).toBeTruthy();
    await h.ui.rpc("setLanguage", { language: "en" });
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("claviger-language")).toBe("en");
  });

  it("a locked popup remounted from the cache paints in the chosen language at once", async () => {
    const h = await harness({ status: "locked" });
    await h.ui.rpc("setLanguage", { language: "en" });
    const first = renderUi(<PopupApp pollMs={0} />, h.ui);
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    first.unmount();
    // System languages say Turkish; only the cache can make the first paint English.
    renderUi(<PopupApp pollMs={0} />, h.ui, readCachedLocale(["tr-TR"]));
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  it("the picker in Preferences switches the language and persists it", async () => {
    const h = await harness();
    window.location.hash = "#/preferences";
    renderUi(<ManageApp pollMs={10} />, h.ui);
    const group = await screen.findByRole("radiogroup", { name: "Dil" });
    expect(group).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(await screen.findByRole("radiogroup", { name: "Language" })).toBeTruthy();
    expect((await h.service.getState()).language).toBe("en");
    const language = screen.getByRole("radiogroup", { name: "Language" });
    await userEvent.click(within(language).getByRole("radio", { name: "System" }));
    await waitFor(async () => expect((await h.service.getState()).language).toBe("system"));
    expect(await screen.findByRole("radiogroup", { name: "Dil" })).toBeTruthy();
  });

  it("registry and values agree; unknown codes and missing keys fall back", () => {
    expect([...LANGUAGE_VALUES]).toEqual(["system", ...LOCALES.map((l) => l.code)]);
    expect(resolveLocale("de", ["tr-TR"])).toBe("tr");
    expect(resolveLocale("system", ["fr-FR", "en-GB"])).toBe("en");
    expect(resolveLocale("tr", ["en-US"])).toBe("tr");
    expect(translate("tr", "no.such.key" as never)).toBe("no.such.key");
  });

  it("falls back to English before the raw key", () => {
    const key = "only.in.en" as never;
    const extra = { tr: {}, en: { [key as string]: "English text" } };
    expect(translate("tr", key, undefined, extra)).toBe("English text");
    expect(translate("tr", key)).toBe("only.in.en");
  });
});
