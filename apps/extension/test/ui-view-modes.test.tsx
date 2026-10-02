// @vitest-environment jsdom
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCode, maskCode } from "@claviger/ui";
import type { UiPlatform } from "@claviger/ui";
import { CodesScreen, REVEAL_SECONDS } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const B = "otpauth://totp/Beta:b@x?secret=GEZDGNBVGY3TQOJQ&issuer=Beta";
const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

async function popupWith(
  mode: "normal" | "compact" | "hidden",
  opts: {
    tabUrl?: string;
    linked?: boolean;
    wrap?: (ui: UiPlatform) => UiPlatform;
    extra?: string;
  } = {},
) {
  const h = await harness({ tabUrl: opts.tabUrl });
  await h.service.addAccount({ uri: A }, opts.linked ? { sourceUrl: "https://acme.com" } : {});
  if (opts.extra) await h.service.addAccount({ uri: opts.extra });
  await h.service.setViewMode(mode);
  const state = await h.service.getState();
  const { container } = renderUi(
    <CodesScreen state={state} pollMs={0} onLocked={() => {}} />,
    opts.wrap ? opts.wrap(h.ui) : h.ui,
  );
  const { accounts } = await h.service.listAccounts();
  return { h, container, code: accounts[0]!.code };
}

describe("view modes", () => {
  it("rows use the inset rounded hover", async () => {
    await popupWith("normal");
    const row = (await screen.findByText("Acme")).closest("li")!;
    for (const c of ["ov-row", "-mx-3", "px-3", "rounded-xl"]) expect(row.className).toContain(c);
    expect(row.className).not.toContain("hover:bg-hair");
  });

  it("the site row uses it too", async () => {
    await popupWith("normal", { tabUrl: "https://acme.com/login", linked: true });
    const site = (await screen.findByText("Bu site")).closest("section")!;
    const row = within(site).getByText("Acme").closest("li")!;
    expect(row.className).toContain("ov-row");
  });

  it("every row has top padding so the label stays off the hover edge", async () => {
    await popupWith("normal", { tabUrl: "https://acme.com/login", linked: true });
    const site = (await screen.findByText("Bu site")).closest("section")!;
    const large = within(site).getByText("Acme").closest("li")!;
    for (const c of ["ov-row", "-mx-3", "px-3", "pt-3", "pb-5"])
      expect(large.className).toContain(c);
  });

  it("labelled small rows have equal top and bottom padding", async () => {
    const { container } = await popupWith("normal");
    await screen.findByText("Acme");
    const cls = container.querySelector("li")!.className;
    expect(cls).toContain("pt-[7px]");
    expect(cls).toContain("pb-[7px]");
  });

  it("hidden mode never puts the code in the DOM but still copies it", async () => {
    const { h, container, code } = await popupWith("hidden");
    const button = await screen.findByRole("button", { name: "Acme kodunu kopyala" });
    expect(container.innerHTML).not.toContain(code);
    expect(container.innerHTML).not.toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(button.textContent).toBe("••• •••");
    await userEvent.setup().click(button);
    expect(h.ui.copy).toHaveBeenCalledWith(code);
  });

  it("copies when the row text is clicked, in hidden mode too", async () => {
    const hidden = await popupWith("hidden");
    await userEvent.setup().click(await screen.findByText("Acme"));
    expect(hidden.h.ui.copy).toHaveBeenCalledWith(hidden.code);
  });

  it("does not copy while the user has text selected", async () => {
    const { h } = await popupWith("normal");
    const label = await screen.findByText("a@x");
    const range = document.createRange();
    range.selectNodeContents(label);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(label);
    window.getSelection()?.removeAllRanges();
    expect(h.ui.copy).not.toHaveBeenCalled();
  });

  it("copies when the issuer text of a normal row is clicked", async () => {
    const { h, code } = await popupWith("normal");
    await userEvent.setup().click(await screen.findByText("a@x"));
    expect(h.ui.copy).toHaveBeenCalledTimes(1);
    expect(h.ui.copy).toHaveBeenCalledWith(code);
  });

  it("the label sits on its own full-width line under the code row", async () => {
    await popupWith("normal");
    const label = await screen.findByText("a@x");
    const row = label.closest("li")!;
    for (const c of ["truncate", "pointer-events-none"]) expect(label.className).toContain(c);
    expect(label.className).not.toMatch(/-m[trblxy]?-/);
    expect(label.parentElement).toBe(row);
    const top = row.querySelector("[data-code-button]")!.parentElement!;
    expect(top.contains(label)).toBe(false);
    expect(top.parentElement).toBe(row);
    expect(row.getAttribute("title")).toBe("Acme: a@x");
  });

  it("labelled rows keep 44px hit areas hanging down from the row top", async () => {
    await popupWith("normal");
    const row = (await screen.findByText("a@x")).closest("li")!;
    const line = row.querySelector("[data-code-button]")!.parentElement!;
    expect(line.className).toContain("z-10");
    for (const el of [
      row.querySelector("[data-code-button]")!,
      row.querySelector("button[aria-haspopup]")!,
    ])
      for (const c of ["h-11", "self-start", "-mt-[7px]"]) expect(el.className).toContain(c);
  });

  it("rows without a label line stay centred one-liners", async () => {
    await popupWith("compact");
    const row = (await screen.findByText("Acme")).closest("li")!;
    expect(row.className).toContain("min-h-11");
    expect(row.querySelector("[data-code-button]")!.className).not.toContain("self-start");
  });

  it("an account without issuer shows its label on line 1 and no second line", async () => {
    const { container } = await popupWith("normal", {
      extra: "otpauth://totp/solo@x?secret=GEZDGNBVGY3TQOJQ",
    });
    const solo = (await screen.findByText("solo@x")).closest("li")!;
    expect(solo.querySelector("[data-row-label]")).toBeNull();
    expect(solo.querySelector("[data-row-name]")!.textContent).toBe("solo@x");
    expect(solo.getAttribute("title")).toBe("solo@x");
    expect(container.querySelectorAll("[data-row-label]")).toHaveLength(1);
  });

  it("compact mode drops the account label line", async () => {
    await popupWith("compact");
    await screen.findByText("Acme");
    expect(screen.queryByText("a@x")).toBeNull();
  });

  it("normal mode shows the label line and the code", async () => {
    const { code } = await popupWith("normal");
    expect(await screen.findByText("a@x")).toBeTruthy();
    expect(screen.getByText(`${code.slice(0, 3)} ${code.slice(3)}`)).toBeTruthy();
  });

  it("reports a successful copy to the background for clipboard clearing", async () => {
    const { h } = await popupWith("normal");
    await h.service.setClipboardClear(30);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^Acme kodunu kopyala/ }));
    await screen.findByText(/kopyalandı/i);
    await vi.waitFor(() => expect(h.p.alarms.scheduled.has("clipboard-clear")).toBe(true));
  });

  it("hides the code in the large this-site row too", async () => {
    const { h, container, code } = await popupWith("hidden", {
      tabUrl: "https://acme.com/login",
      linked: true,
    });
    const button = await screen.findByRole("button", { name: "Acme kodunu kopyala" });
    expect(screen.getByText("Bu site")).toBeTruthy();
    expect(container.innerHTML).not.toContain(code);
    await userEvent.setup().click(button);
    expect(h.ui.copy).toHaveBeenCalledWith(code);
  });

  it("hides the code of an HOTP row", async () => {
    const { container } = await popupWith("hidden", {
      extra: "otpauth://hotp/Bank:ali?secret=JBSWY3DPEHPK3PXP&issuer=Bank&counter=4",
    });
    const button = await screen.findByRole("button", { name: "Bank kodunu kopyala" });
    expect(button.textContent).toBe("\u2022\u2022\u2022 \u2022\u2022\u2022");
    expect(container.querySelectorAll("[data-code-button]")).toHaveLength(2);
  });

  it("keeps the copied toast when reporting the copy fails", async () => {
    await popupWith("normal", {
      wrap: (ui) => ({
        ...ui,
        rpc: (async (type: string, payload: unknown) => {
          if (type === "clipboardCopied") throw new Error("boom");
          return ui.rpc(type as never, payload as never);
        }) as UiPlatform["rpc"],
      }),
    });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^Acme kodunu kopyala/ }));
    expect(await screen.findByText(/kopyalandı/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not report a failed copy to the background", async () => {
    const { h } = await popupWith("normal");
    await h.service.setClipboardClear(30);
    h.ui.copy.mockRejectedValueOnce(new Error("denied"));
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^Acme kodunu kopyala/ }));
    expect(await screen.findByText("Kopyalanamadı.")).toBeTruthy();
    expect(h.p.alarms.scheduled.has("clipboard-clear")).toBe(false);
  });
});

describe("maskCode", () => {
  it.each([6, 7, 8, 5])("groups %i digits like formatCode", (digits) => {
    const digitsText = "1234567890".slice(0, digits);
    expect(maskCode(digits)).toBe(formatCode(digitsText).replace(/\d/g, "\u2022"));
    expect(maskCode(digits)).not.toMatch(/\d/);
  });
});

describe("tap to reveal (hidden mode)", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
  const absent = (container: HTMLElement, code: string) => {
    expect(container.innerHTML).not.toContain(code);
    expect(container.innerHTML).not.toContain(spaced(code));
  };

  it("reveals on the eye button, copies on code click, hides after REVEAL_SECONDS", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { h, container, code } = await popupWith("hidden");
    const eye = await screen.findByRole("button", { name: "Acme kodunu g\u00f6ster" });
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    absent(container, code);
    await user.click(eye);
    expect(container.innerHTML).toContain(spaced(code));
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    expect(eye.getAttribute("aria-label")).toBe("Acme kodunu gizle");
    await user.click(screen.getByRole("button", { name: /kodunu kopyala|Kopyala|kopyala/ }));
    expect(h.ui.copy).toHaveBeenCalledWith(code);
    expect(container.innerHTML).toContain(spaced(code));
    act(() => void vi.advanceTimersByTime(REVEAL_SECONDS * 1000));
    absent(container, code);
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(eye);
  });

  it("the announcement region never contains the code", async () => {
    const user = userEvent.setup();
    const { container, code } = await popupWith("hidden");
    await user.click(await screen.findByRole("button", { name: "Acme kodunu g\u00f6ster" }));
    const live = container.querySelector("[aria-live]")!;
    expect(live.textContent).toContain(String(REVEAL_SECONDS));
    expect(live.textContent).not.toContain(code.slice(0, 3));
    expect(live.innerHTML).not.toContain(code);
  });

  it("only one row is revealed at a time", async () => {
    const user = userEvent.setup();
    const { container, h } = await popupWith("hidden", { extra: B });
    const [a, b] = (await h.service.listAccounts()).accounts;
    await user.click(await screen.findByRole("button", { name: "Acme kodunu g\u00f6ster" }));
    expect(container.innerHTML).toContain(spaced(a!.code));
    await user.click(screen.getByRole("button", { name: "Beta kodunu g\u00f6ster" }));
    absent(container, a!.code);
    expect(container.innerHTML).toContain(spaced(b!.code));
  });

  it("normal mode has no eye button", async () => {
    await popupWith("normal");
    await screen.findByText("Acme");
    expect(screen.queryByRole("button", { name: /kodunu g\u00f6ster/ })).toBeNull();
  });

  it("hides on lock", async () => {
    const user = userEvent.setup();
    const { container, code } = await popupWith("hidden");
    await user.click(await screen.findByRole("button", { name: "Acme kodunu g\u00f6ster" }));
    expect(container.innerHTML).toContain(spaced(code));
    await user.click(screen.getByRole("button", { name: "Kilitle" }));
    absent(container, code);
  });

  it("hides when the tab becomes hidden", async () => {
    const user = userEvent.setup();
    const { container, code } = await popupWith("hidden");
    await user.click(await screen.findByRole("button", { name: "Acme kodunu g\u00f6ster" }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    absent(container, code);
  });

  it("hides when the view mode leaves Hidden and stays hidden on return", async () => {
    const user = userEvent.setup();
    const h = await harness({});
    await h.service.addAccount({ uri: A }, {});
    await h.service.setViewMode("hidden");
    const state = await h.service.getState();
    let setMode: (m: "normal" | "hidden") => void = () => {};
    function Host() {
      const [m, s] = useState<"normal" | "hidden">("hidden");
      setMode = s;
      return <CodesScreen state={{ ...state, viewMode: m }} pollMs={0} onLocked={() => {}} />;
    }
    const { container } = renderUi(<Host />, h.ui);
    const code = (await h.service.listAccounts()).accounts[0]!.code;
    await user.click(await screen.findByRole("button", { name: "Acme kodunu g\u00f6ster" }));
    expect(container.innerHTML).toContain(spaced(code));
    act(() => setMode("normal"));
    act(() => setMode("hidden"));
    absent(container, code);
  });
});
