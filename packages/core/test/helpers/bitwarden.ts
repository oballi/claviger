export const bitwardenAuthenticator = () => ({
  encrypted: false,
  items: [
    {
      favorite: false,
      id: "00000000-0000-4000-8000-000000000001",
      type: 1,
      name: "Deno",
      login: {
        username: "mason@example.test",
        totp: "otpauth://totp/Deno:mason@example.test?secret=4SJHB4GSD43FZBAI7C2HLRJGPQ&issuer=Deno&algorithm=SHA1&digits=6&period=30",
      },
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      type: 1,
      name: "Steam",
      login: { username: "gaben", totp: "steam://JRZCL47CMXVOQMNPZR2F7J4RGI" },
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      type: 1,
      name: "Bare",
      login: { username: "u", totp: "gezd gnbv gy3t qojq" },
    },
    // Battle.net is a plain 8-digit SHA1 TOTP (Aegis BattleNetImporter), no special type needed.
    {
      id: "00000000-0000-4000-8000-000000000004",
      type: 1,
      name: "Battle.net",
      login: {
        username: "player#1234",
        totp: "otpauth://totp/Battle.net:player?secret=GEZDGNBVGY3TQOJQ&issuer=Battle.net&digits=8",
      },
    },
  ],
});

export const bitwardenVault = () => ({
  encrypted: false,
  folders: [],
  items: [
    ...bitwardenAuthenticator().items,
    {
      id: "x1",
      type: 1,
      name: "No 2FA here",
      login: { username: "u", password: "SYNTHETIC-NOT-A-REAL-PASSWORD" },
    },
    { id: "x2", type: 2, name: "Secure note", notes: "synthetic note" },
  ],
});
