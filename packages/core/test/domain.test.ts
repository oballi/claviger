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
  const bound = { issuer: "GitHub", domains: ["github.com"] };
  const unbound = { issuer: "GitHub", domains: [] as string[] };
  const google = { issuer: "Google", domains: ["google.com"] };
  const aws = { issuer: "AWS", domains: [] as string[] };
  const accounts = [bound, unbound, google, aws];

  it("matches exact registrable domains, including subdomains of the page", () => {
    expect(matchAccounts(accounts, "https://gist.github.com/x")).toEqual({
      exact: [bound],
      suggested: [unbound],
    });
  });

  it("suggests (never auto-fills) on an exact issuer/domain-label match", () => {
    expect(matchAccounts(accounts, "https://accounts.google.co.uk")).toEqual({
      exact: [],
      suggested: [google],
    });
  });

  it("does not suggest look-alike phishing domains", () => {
    expect(matchAccounts(accounts, "https://evil-github.com/login")).toEqual({
      exact: [],
      suggested: [],
    });
    // Suggestions are hints only; fill is gated on linked domains (see service-fill tests).
    expect(matchAccounts(accounts, "https://github.com.evil.io/login").exact).toEqual([]);
  });

  it("ignores short labels and non-web pages", () => {
    const short = { issuer: "AB", domains: [] as string[] };
    expect(matchAccounts([short], "https://ab.example.com").suggested).toEqual([]);
    expect(matchAccounts(accounts, "chrome://settings")).toEqual({ exact: [], suggested: [] });
    expect(matchAccounts(accounts, "not a url")).toEqual({ exact: [], suggested: [] });
  });

  describe("broader suggestions", () => {
    const idrive = { issuer: "iDrive", domains: [] as string[] };
    const acme = { issuer: "Acme", domains: [] as string[] };
    const mail = { issuer: "Work", label: "ada@acme.example", domains: [] as string[] };
    const other = { issuer: "Other", label: "me@example.com", domains: [] as string[] };
    const list = [other, mail, acme, idrive];

    it("suggests on any non-suffix host label, in list order, without duplicates", () => {
      const r = matchAccounts(list, "https://idrive.acme.example/x");
      expect(r.exact).toEqual([]);
      expect(r.suggested).toEqual([mail, acme, idrive]);
    });

    it("suggests on an e-mail whose registrable domain is the page's", () => {
      expect(matchAccounts([other, mail], "https://acme.example").suggested).toEqual([mail]);
      const byIssuer = { issuer: "a@sub.acme.example", domains: [] as string[] };
      expect(matchAccounts([byIssuer], "https://www.acme.example").suggested).toEqual([byIssuer]);
    });

    it("keeps exact first and out of suggestions", () => {
      const bound = { issuer: "Acme", domains: ["acme.example"] };
      const r = matchAccounts([acme, bound], "https://idrive.acme.example");
      expect(r).toEqual({ exact: [bound], suggested: [acme] });
    });

    it("ignores public-suffix labels, www, short labels and look-alike e-mails", () => {
      const co = { issuer: "com", domains: [] as string[] };
      const tr = { issuer: "tr", domains: [] as string[] };
      const www = { issuer: "www", domains: [] as string[] };
      const lookalike = { issuer: "X", label: "a@acme.example.evil.io", domains: [] as string[] };
      const r = matchAccounts([co, tr, www, lookalike], "https://www.acme.example");
      expect(r.suggested).toEqual([]);
    });

    it("does not use labels for IPs", () => {
      const ip = { issuer: "192", domains: [] as string[] };
      expect(matchAccounts([ip], "http://192.168.1.10").suggested).toEqual([]);
    });

    it("suggests a host-label issuer on localhost-style dotless hosts", () => {
      const lh = { issuer: "localhost", domains: [] as string[] };
      expect(matchAccounts([lh], "http://localhost:3000").suggested).toEqual([lh]);
    });

    it("suggests on a look-alike page host (hint only; fill is gated separately)", () => {
      const bank = { issuer: "Bank", domains: ["bank.com"] };
      expect(matchAccounts([bank], "https://bank.com.evil.io/")).toEqual({
        exact: [],
        suggested: [bank],
      });
    });
  });
});
