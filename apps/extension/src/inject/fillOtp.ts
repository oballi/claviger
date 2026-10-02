export type FillResult = "filled" | "no-field";

// Serialized by executeScript: must stay self-contained (no imports, no closures).
export function fillOtp(code: string, explicit = false): FillResult {
  // Deny-list keeps coupon/zip style fields from being treated as OTP inputs.
  const HINT =
    /otp|2fa|mfa|totp|one.?time|verif|authenticator|(security|auth|login|sms|access)[ _-]?code|^code$|^kod$|doğrulama/i;
  const NOT_OTP =
    /zip|postal|post.?code|promo|coupon|discount|voucher|country|area|invite|referral|captcha|search|user|login|e-?mail|phone|name/i;
  const AC_NOT_OTP =
    /\b(username|email|name|tel|current-password|new-password|street-address|postal-code|cc-\w+)\b/;
  const textual = (el: HTMLInputElement) => ["text", "tel", "number", ""].includes(el.type);
  const visible = (el: HTMLElement) => el.getClientRects().length > 0;
  const usable = (el: HTMLInputElement) => visible(el) && !el.disabled && !el.readOnly;
  const isOtp = (el: HTMLInputElement) => el.autocomplete.split(/\s+/).includes("one-time-code");
  const meta = (el: HTMLInputElement) =>
    `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") ?? ""}`;
  const looksOtp = (el: HTMLInputElement) =>
    textual(el) &&
    !AC_NOT_OTP.test(el.autocomplete) &&
    (isOtp(el) ||
      (HINT.test(meta(el)) && !NOT_OTP.test(meta(el))) ||
      (el.inputMode === "numeric" && el.maxLength >= 4 && el.maxLength <= 10));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const write = (el: HTMLInputElement, value: string) => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const inputs = Array.from(document.querySelectorAll("input")).filter(usable);

  const active = document.activeElement;
  if (active instanceof HTMLInputElement && usable(active) && textual(active)) {
    if (looksOtp(active) || (explicit && !AC_NOT_OTP.test(active.autocomplete))) {
      write(active, code);
      return "filled";
    }
  }

  let run: HTMLInputElement[] = [];
  for (const el of inputs) {
    if (el.maxLength === 1) run.push(el);
    else if (run.length >= 4) break;
    else run = [];
  }
  if (run.length >= 4 && run.length >= code.length) {
    [...code].forEach((digit, i) => write(run[i]!, digit));
    run[code.length - 1]?.focus();
    return "filled";
  }
  const target = inputs.find(isOtp) ?? inputs.find(looksOtp);
  if (!target) return "no-field";
  write(target, code);
  target.focus();
  return "filled";
}
