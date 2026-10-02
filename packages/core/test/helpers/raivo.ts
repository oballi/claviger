// Synthetic secrets only. Raivo exports every value as a string.
export const RAIVO_ENTRIES = [
  {
    kind: "TOTP",
    issuer: "Deno",
    account: "Mason",
    secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ",
    algorithm: "SHA1",
    digits: "6",
    timer: "30",
    counter: "0",
  },
  {
    kind: "HOTP",
    issuer: "Issuu",
    account: "James",
    secret: "YOOMIXWS5GN6RTBPUFFWKTW5M4",
    algorithm: "SHA256",
    digits: "8",
    timer: "30",
    counter: "4",
  },
  {
    kind: "MOTP",
    issuer: "Mobile",
    account: "m",
    secret: "MFRGGZDFMZTWQ2LK",
    algorithm: "SHA1",
    digits: "6",
    timer: "30",
    counter: "0",
  },
];
