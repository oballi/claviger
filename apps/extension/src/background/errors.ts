export type ServiceErrorCode =
  | "no-vault"
  | "locked"
  | "throttled"
  | "wrong-password"
  | "invalid-token"
  | "already-set-up"
  | "preview-expired"
  | "invalid-request";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: ServiceErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}
