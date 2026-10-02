export type CoreErrorCode =
  | "invalid-hex"
  | "invalid-base64"
  | "invalid-base32"
  | "invalid-protobuf"
  | "invalid-otp-params"
  | "unsupported-otp-type"
  | "unsupported-algorithm"
  | "invalid-uri"
  | "wrong-password"
  | "invalid-recovery-code"
  | "vault-not-found"
  | "vault-exists"
  | "vault-corrupt"
  | "account-not-found"
  | "duplicate-account"
  | "unsupported-format"
  | "corrupt-file"
  | "invalid-group-name"
  | "duplicate-group"
  | "group-limit"
  | "group-not-found"
  | "trash-entry-not-found"
  | "trash-corrupt";

export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoreError";
    this.code = code;
  }
}

export function isCoreError(e: unknown, code?: CoreErrorCode): e is CoreError {
  return e instanceof CoreError && (code === undefined || e.code === code);
}
