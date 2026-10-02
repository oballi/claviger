// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RpcError } from "@otp-vault/ui/rpc-client";
import { Button } from "@otp-vault/ui";
import { ErrorBoundary } from "@otp-vault/ui";
import { Icon } from "@otp-vault/ui";
import { TextField } from "@otp-vault/ui";
import { errorMessage } from "@otp-vault/ui";
import {
  formatCode,
  formatDate,
  isoDate,
  lockPolicyLabel,
  lockPolicySentence,
  passwordStrength,
} from "@otp-vault/ui";
import { en } from "@otp-vault/ui";
import { pickLocale, translate } from "@otp-vault/ui";
import { tr } from "@otp-vault/ui";
import { harness, renderUi } from "./helpers/ui";

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate("tr", key, vars);

describe("i18n", () => {
  it("picks Turkish only when the browser prefers it", () => {
    expect(pickLocale(["tr-TR", "en-US"])).toBe("tr");
    expect(pickLocale(["en-GB", "tr"])).toBe("en");
    expect(pickLocale([])).toBe("en");
  });

  it("has the same keys in both languages and fills variables", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(tr) as (keyof typeof tr)[]) {
      expect(vars(en[key]), key).toEqual(vars(tr[key]));
    }
    expect(translate("tr", "lock.wait", { seconds: 4 })).toBe(
      "Çok fazla hatalı deneme. 4 sn sonra tekrar dene.",
    );
    expect(translate("en", "lock.wait", {})).toBe(
      "Too many wrong attempts. Try again in {seconds} s.",
    );
  });
});

describe("formatting helpers", () => {
  it.each([
    ["492018", "492 018"],
    ["84021937", "8402 1937"],
    ["1234567", "123 4567"],
    ["GG5F5", "GG5F5"],
  ])("groups %s as %s", (code, grouped) => {
    expect(formatCode(code)).toBe(grouped);
  });

  it.each([
    ["short", 0],
    ["abcdefgh", 1],
    ["abcdefghij12", 2],
    ["Abcdefghij1!", 3],
    ["kirmizi-bisiklet-ruzgar", 4],
  ])("rates %s as %i", (password, score) => {
    expect(passwordStrength(password)).toBe(score);
  });

  it("names lock policies", () => {
    expect(lockPolicyLabel(t, { kind: "browser-close" })).toBe("Tarayıcı kapanınca");
    expect(lockPolicyLabel(t, { kind: "timeout", minutes: 60 })).toBe("1 saat kullanılmayınca");
    expect(lockPolicySentence(t, { kind: "never" })).toBe("Kendiliğinden kilitlenmez");
    expect(lockPolicySentence(t, { kind: "timeout", minutes: 15 })).toBe(
      "15 dk kullanılmayınca kilitlenir",
    );
  });

  it("formats dates", () => {
    const ms = Date.UTC(2026, 9, 1, 12);
    expect(isoDate(ms)).toBe("2026-10-01");
    expect(formatDate("tr", ms)).toContain("2026");
  });
});

describe("errorMessage", () => {
  it("translates known codes, including retry delays, and hides unknown ones", () => {
    expect(errorMessage(t, new RpcError("wrong-password", "x", 0))).toBe("Parola yanlış.");
    expect(errorMessage(t, new RpcError("throttled", "x", 2500))).toBe(
      "Çok fazla hatalı deneme. 3 sn sonra tekrar dene.",
    );
    expect(errorMessage(t, new RpcError("something-new", "internal detail"))).toBe(
      "Beklenmeyen bir hata oluştu.",
    );
    expect(errorMessage(t, new Error("boom"))).toBe("Beklenmeyen bir hata oluştu.");
  });
});

let explode = true;

function Bomb() {
  if (explode) throw new Error("render failed");
  return <p>ok</p>;
}

describe("components and harness", () => {
  it("renders accessible buttons, underline fields and icons", async () => {
    const { ui } = await harness();
    renderUi(
      <div>
        <Button variant="primary">Kaydet</Button>
        <TextField id="name" label="Ad" hint="İpucu" error="Hata" mono />
        <Icon name="lock" />
      </div>,
      ui,
    );
    expect(screen.getByRole("button", { name: "Kaydet" })).toHaveProperty("type", "button");
    const input = screen.getByLabelText("Ad");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("name-hint name-error");
    expect(screen.getByRole("alert").textContent).toBe("Hata");
  });

  it("shows a retry instead of a blank page when rendering fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ui } = await harness();
    renderUi(
      <ErrorBoundary message="Bozuldu" retryLabel="Tekrar dene">
        <Bomb />
      </ErrorBoundary>,
      ui,
    );
    expect(screen.getByRole("alert").textContent).toContain("Bozuldu");
    explode = false;
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(screen.getByText("ok")).toBeTruthy();
    spy.mockRestore();
  });

  it("connects the UI to a real vault service", async () => {
    const { ui } = await harness({ status: "locked" });
    expect((await ui.rpc("getState", {})).status).toBe("locked");
  });
});
