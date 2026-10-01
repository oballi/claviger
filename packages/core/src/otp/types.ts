export type OtpType = "totp" | "hotp" | "steam";
export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export const OTP_TYPES: readonly OtpType[] = ["totp", "hotp", "steam"];
export const OTP_ALGORITHMS: readonly OtpAlgorithm[] = ["SHA1", "SHA256", "SHA512"];
