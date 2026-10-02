import { describe, expect, it } from "vitest";
import { matchAccounts, registrableDomain } from "../src/match/domain";

describe("registrableDomain", () => {
  it.each([
    ["https://login.github.com/session", "github.com"],
    ["accounts.google.co.uk", "google.co.uk"],
    ["Login.GitHub.com", "github.com"],
    ["https://foo.github.io/app", "foo.github.io"],
    ["http://192.168.1.10:8080/x", "192.168.1.10"],
    ["http://[::1]:3000", "::1"],
    ["localhost", "localhost"],
  ])("%s → %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it.each(["", "   ", "chrome://extensions", "file:///etc/passwd", "https://"])(
    "rejects %j",
    (input) => {
      expect(registrableDomain(input)).toBeNull();
    },
  );
});

describe("matchAccounts", () => {
  it("returns only accounts whose domains include the registrable domain of the page", () => {
    const accounts = [
      { issuer: "Acme", label: "me", domains: ["acme.com"] },
      { issuer: "Acme", label: "work@acme.com", domains: [] as string[] },
      { issuer: "acme", label: "", domains: ["other.com"] },
    ];
    expect(matchAccounts(accounts, "https://login.acme.com/x")).toEqual({ exact: [accounts[0]] });
  });

  it("never matches look-alike hosts", () => {
    const bank = { domains: ["bank.com"] };
    for (const url of [
      "https://bank.com.evil.io/",
      "https://evil-bank.com/login",
      "https://bank.co/",
    ]) {
      expect(matchAccounts([bank], url)).toEqual({ exact: [] });
    }
  });

  it("matches nothing on non-web pages and non-URLs", () => {
    const a = { domains: ["settings"] };
    expect(matchAccounts([a], "chrome://settings")).toEqual({ exact: [] });
    expect(matchAccounts([a], "not a url")).toEqual({ exact: [] });
  });

  it("matches localhost and IPs only when linked to that exact host", () => {
    const lh = { domains: ["localhost"] };
    const ip = { domains: ["192.168.1.10"] };
    const none = { domains: [] as string[] };
    expect(matchAccounts([lh, ip, none], "http://localhost:3000")).toEqual({ exact: [lh] });
    expect(matchAccounts([lh, ip, none], "http://192.168.1.10:8080/x")).toEqual({ exact: [ip] });
    expect(matchAccounts([lh, ip, none], "http://192.168.1.11")).toEqual({ exact: [] });
  });
});
