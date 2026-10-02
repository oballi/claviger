export type FillResult = "filled" | "no-field" | "wrong-site";

// Serialized by executeScript: must stay self-contained (no imports, no closures).
export function fillOtp(code: string, explicit: boolean, expectedDomain: string): FillResult {
  // The tab may have navigated since the background checked it; the page re-verifies where it is.
  const secure =
    location.protocol === "https:" ||
    (location.protocol === "http:" &&
      (location.hostname === "localhost" || location.hostname === "127.0.0.1"));
  if (
    !secure ||
    !expectedDomain ||
    !(location.hostname === expectedDomain || location.hostname.endsWith("." + expectedDomain))
  )
    return "wrong-site";
  // Steam codes are 5 alphanumerics; anything else is not a code we should type.
  if (!/^[0-9A-Z]{4,10}$/.test(code)) return "no-field";
  // Deny-list keeps coupon/zip style fields from being treated as OTP inputs.
  const HINT =
    /otp|2fa|mfa|totp|one.?time|verif|authenticator|(security|auth|login|sms|access)[ _-]?code|^code$|^kod$|doğrulama/i;
  const NOT_OTP =
    /zip|postal|post.?code|promo|coupon|discount|voucher|country|area|invite|referral|captcha|search|user|e-?mail|phone|name/i;
  const ac = (el: HTMLInputElement) => el.autocomplete.toLowerCase();
  const AC_NOT_OTP =
    /\b(username|email|name|tel|current-password|new-password|street-address|postal-code|cc-\w+)\b/;
  const visible = (el: HTMLElement) =>
    Array.from(el.getClientRects()).some((r) => r.width > 0 && r.height > 0);
  const usable = (el: HTMLInputElement) => visible(el) && !el.disabled && !el.readOnly;
  const isOtp = (el: HTMLInputElement) => ac(el).split(/\s+/).includes("one-time-code");
  // A password-typed box is only ever eligible when the page marks it one-time-code.
  const textual = (el: HTMLInputElement) =>
    ["text", "tel", "number", ""].includes(el.type) || (el.type === "password" && isOtp(el));
  const eligible = (el: HTMLInputElement) => textual(el) && !AC_NOT_OTP.test(ac(el));
  // Attributes are tested one by one so anchored hints like ^code$ can match.
  const attrs = (el: HTMLInputElement) => [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute("aria-label") ?? "",
  ];
  const denied = (el: HTMLInputElement) => attrs(el).some((a) => NOT_OTP.test(a));
  const looksOtp = (el: HTMLInputElement) =>
    eligible(el) &&
    (isOtp(el) ||
      (attrs(el).some((a) => HINT.test(a)) && !denied(el)) ||
      (el.inputMode === "numeric" && el.maxLength >= 4 && el.maxLength <= 10 && !denied(el)));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const write = (el: HTMLInputElement, value: string) => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const inputs = Array.from(document.querySelectorAll("input")).filter(usable);

  // A focused split box must not receive the whole code; the run step handles it.
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement &&
    usable(active) &&
    active.maxLength !== 1 &&
    eligible(active) &&
    (looksOtp(active) || (explicit && !denied(active)))
  ) {
    write(active, code);
    return "filled";
  }

  const declared = inputs.find((el) => eligible(el) && isOtp(el));
  if (declared) {
    write(declared, code);
    declared.focus();
    return "filled";
  }

  const boxOk = (el: HTMLInputElement) => el.maxLength === 1 && eligible(el) && !denied(el);
  const group = (el: HTMLInputElement) => el.parentElement?.parentElement;
  let run: HTMLInputElement[] = [];
  for (const el of inputs) {
    if (boxOk(el) && (run.length === 0 || group(el) === group(run[0]!))) run.push(el);
    else if (run.length >= 4) break;
    else run = boxOk(el) ? [el] : [];
  }
  if (run.length >= 4 && run.length <= 10 && run.length >= code.length) {
    [...code].forEach((ch, i) => write(run[i]!, ch));
    run[code.length - 1]?.focus();
    return "filled";
  }

  const target = inputs.find((el) => el.maxLength !== 1 && looksOtp(el));
  if (!target) return "no-field";
  write(target, code);
  target.focus();
  return "filled";
}
