// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillOtp } from "../src/inject/fillOtp";

function page(html: string) {
  document.body.innerHTML = html;
  // jsdom has no layout; every element counts as visible unless marked hidden.
  for (const el of document.querySelectorAll<HTMLElement>("input"))
    el.getClientRects = () =>
      (el.dataset.hidden ? [] : [{ width: 10, height: 10 }]) as unknown as DOMRectList;
}
const $ = (sel: string) => document.querySelector(sel) as HTMLInputElement;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("fillOtp", () => {
  it("does not fill a plain focused text field without OTP hints", () => {
    page(`<input id="c" type="text">`);
    $("#c").focus();
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
    expect($("#c").value).toBe("");
  });

  it("fills a focused field with OTP hints and fires input and change", () => {
    page(`<input id="c" name="otp_code" type="text">`);
    const input = $("#c");
    input.focus();
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    expect(fillOtp("123456", false, "localhost")).toBe("filled");
    expect(input.value).toBe("123456");
    expect(events).toEqual(["input", "change"]);
  });

  it("fills the OTP field, never the focused username or email", () => {
    page(
      `<input id="u" name="username" autocomplete="username"><input id="e" type="email" autocomplete="email"><input id="o" name="totp">`,
    );
    for (const id of ["#u", "#e"]) {
      $(id).focus();
      expect(fillOtp("123456", false, "localhost")).toBe("filled");
      expect($(id).value).toBe("");
      expect($("#o").value).toBe("123456");
      $("#o").value = "";
    }
  });

  it("treats zipcode, promo_code and coupon fields as no-field", () => {
    for (const name of ["zipcode", "promo_code", "coupon"]) {
      page(`<input id="f" name="${name}">`);
      $("#f").focus();
      expect(fillOtp("123456", false, "localhost")).toBe("no-field");
      expect($("#f").value).toBe("");
    }
  });

  it("does not treat a numeric zip or phone field as an OTP input", () => {
    for (const name of ["zip", "phone"]) {
      page(`<input name="${name}" inputmode="numeric" maxlength="5">`);
      expect(fillOtp("123456", false, "localhost")).toBe("no-field");
    }
  });

  it("matches autocomplete tokens case-insensitively", () => {
    page(`<input id="f" autocomplete="Email">`);
    $("#f").focus();
    expect(fillOtp("123456", true, "localhost")).toBe("no-field");
    page(`<input id="o" autocomplete="One-Time-Code">`);
    expect(fillOtp("123456", false, "localhost")).toBe("filled");
    expect($("#o").value).toBe("123456");
  });

  it("fills a plain focused field only when explicit", () => {
    page(`<input id="c" type="text">`);
    $("#c").focus();
    expect(fillOtp("123456", true, "localhost")).toBe("filled");
    expect($("#c").value).toBe("123456");
  });

  it("never fills username/email/password/cc fields, even when explicit", () => {
    for (const ac of [
      "username",
      "email",
      "current-password",
      "new-password",
      "cc-number",
      "cc-csc",
      "section-x username",
    ]) {
      page(`<input id="f" autocomplete="${ac}">`);
      $("#f").focus();
      expect(fillOtp("123456", true, "localhost")).toBe("no-field");
      expect($("#f").value).toBe("");
    }
  });

  it("never writes into a focused password field", () => {
    page(`<input id="p" type="password"><input id="o" autocomplete="one-time-code">`);
    $("#p").focus();
    expect(fillOtp("123456", true, "localhost")).toBe("filled");
    expect($("#p").value).toBe("");
    expect($("#o").value).toBe("123456");
  });

  it("applies the deny list to hinted names and rejects non-text types", () => {
    page(`<input id="f" name="verification_promo">`);
    $("#f").focus();
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
    page(`<input id="f" type="checkbox" name="otp">`);
    $("#f").focus();
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("matches one-time-code among whitespace-separated tokens", () => {
    page(`<input id="f" autocomplete="section-x&#9;one-time-code">`);
    expect(fillOtp("123456", false, "localhost")).toBe("filled");
    expect($("#f").value).toBe("123456");
  });

  it("never fills password PIN boxes or cc/username boxes as a split run", () => {
    const boxes = (attr: string) =>
      Array.from({ length: 6 }, () => `<input ${attr} maxlength="1">`).join("");
    for (const attr of [
      'type="password"',
      'autocomplete="cc-csc"',
      'autocomplete="username"',
      'name="username"',
    ]) {
      page(boxes(attr));
      expect(fillOtp("123456", false, "localhost")).toBe("no-field");
    }
  });

  it("fills password-typed boxes only when marked one-time-code", () => {
    page(
      Array.from(
        { length: 6 },
        () => `<input type="password" autocomplete="one-time-code" maxlength="1">`,
      ).join(""),
    );
    expect(fillOtp("123456", false, "localhost")).toBe("filled");
  });

  it("does not join boxes from unrelated containers", () => {
    page(Array.from({ length: 6 }, () => `<div><div><input maxlength="1"></div></div>`).join(""));
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("fills only the first code-length boxes of a longer run", () => {
    page(`<div>${Array.from({ length: 8 }, () => `<input maxlength="1">`).join("")}</div>`);
    expect(fillOtp("123456", false, "localhost")).toBe("filled");
    expect(Array.from(document.querySelectorAll("input"), (i) => i.value).join("")).toBe("123456");
  });

  it("spreads the code over all boxes when the first box is focused", () => {
    page(Array.from({ length: 6 }, () => `<input maxlength="1">`).join(""));
    document.querySelector("input")!.focus();
    expect(fillOtp("123456", true, "localhost")).toBe("filled");
    expect(Array.from(document.querySelectorAll("input"), (i) => i.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });

  it("matches anchored and login_code hints per attribute", () => {
    for (const attr of ['name="code"', 'name="kod"', 'id="login_code"']) {
      page(`<input ${attr}>`);
      expect(fillOtp("123456", false, "localhost")).toBe("filled");
    }
    page(`<input name="username" placeholder="code">`);
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("rejects explicit fill into a denied field and invalid codes", () => {
    page(`<input id="f" name="promo">`);
    $("#f").focus();
    expect(fillOtp("123456", true, "localhost")).toBe("no-field");
    page(`<input autocomplete="one-time-code">`);
    expect(fillOtp("12 34", false, "localhost")).toBe("no-field");
    expect(fillOtp("abcdef", false, "localhost")).toBe("no-field");
    expect(fillOtp("AB3CD", false, "localhost")).toBe("filled");
  });

  it("skips zero-size fields", () => {
    page(`<input autocomplete="one-time-code">`);
    $("input").getClientRects = () => [{ width: 0, height: 0 }] as unknown as DOMRectList;
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("rejects runs longer than ten boxes and never dumps a code into one box", () => {
    page(`<div>${Array.from({ length: 11 }, () => `<input maxlength="1">`).join("")}</div>`);
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
    page(Array.from({ length: 3 }, () => `<input name="otp" maxlength="1">`).join(""));
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("fills six single-character boxes in order", () => {
    page(Array.from({ length: 6 }, (_, i) => `<input id="b${i}" maxlength="1">`).join(""));
    expect(fillOtp("987654", false, "localhost")).toBe("filled");
    const values = Array.from(document.querySelectorAll("input"), (i) => i.value).join("");
    expect(values).toBe("987654");
  });

  it("uses the React-compatible value setter", () => {
    page(`<input id="c" autocomplete="one-time-code">`);
    const input = $("#c");
    // An own-property setter would hide the change from React's value tracker.
    const ownSetter = vi.fn();
    Object.defineProperty(input, "value", {
      set: ownSetter,
      get: () => "",
      configurable: true,
    });
    fillOtp("111222", false, "localhost");
    expect(ownSetter).not.toHaveBeenCalled();
  });

  it("finds a field by its name or label hint", () => {
    page(`<input name="email"><input name="totp_code" type="tel">`);
    expect(fillOtp("123456", false, "localhost")).toBe("filled");
    expect($('[name="totp_code"]').value).toBe("123456");
    expect($('[name="email"]').value).toBe("");
  });

  it("skips hidden and disabled fields", () => {
    page(
      `<input autocomplete="one-time-code" data-hidden="1"><input autocomplete="one-time-code" disabled>`,
    );
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("reports no-field on a page without a candidate", () => {
    page(`<input name="search">`);
    expect(fillOtp("123456", false, "localhost")).toBe("no-field");
  });

  it("does not depend on anything outside its own body", () => {
    // executeScript serializes the function; module-scope references would be undefined in the page.
    const source = fillOtp.toString();
    expect(source).not.toMatch(/\bimport\b|require\(/);
    expect(new Function(`return (${source})`)()("123456", false, "localhost")).toBe("no-field");
  });

  describe("site check inside the page", () => {
    const at = (protocol: string, hostname: string) =>
      vi.stubGlobal("location", { protocol, hostname });
    const otpPage = () => page(`<input id="o" autocomplete="one-time-code">`);

    it("fills on the expected domain and on its subdomains", () => {
      otpPage();
      at("https:", "bank.com");
      expect(fillOtp("123456", false, "bank.com")).toBe("filled");
      $("#o").value = "";
      at("https:", "login.bank.com");
      expect(fillOtp("123456", false, "bank.com")).toBe("filled");
    });

    it.each(["bank.com.evil.io", "evilbank.com", "bank.co"])("refuses look-alike %s", (host) => {
      otpPage();
      at("https:", host);
      expect(fillOtp("123456", false, "bank.com")).toBe("wrong-site");
      expect($("#o").value).toBe("");
    });

    it("refuses http except on local development hosts", () => {
      otpPage();
      at("http:", "bank.com");
      expect(fillOtp("123456", false, "bank.com")).toBe("wrong-site");
      at("http:", "127.0.0.1");
      expect(fillOtp("123456", false, "127.0.0.1")).toBe("filled");
    });

    it("refuses an empty expected domain and other schemes", () => {
      otpPage();
      at("https:", "bank.com");
      expect(fillOtp("123456", false, "")).toBe("wrong-site");
      at("file:", "");
      expect(fillOtp("123456", false, "")).toBe("wrong-site");
    });
  });
});
