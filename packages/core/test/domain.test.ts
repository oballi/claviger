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
    expect(matchAccounts(accounts, "https://github.com.evil.io/login")).toEqual({
      exact: [],
      suggested: [],
    });
  });

  it("ignores short labels and non-web pages", () => {
    expect(matchAccounts(accounts, "https://aws.amazon.com").suggested).toEqual([]);
    expect(matchAccounts(accounts, "chrome://settings")).toEqual({ exact: [], suggested: [] });
    expect(matchAccounts(accounts, "not a url")).toEqual({ exact: [], suggested: [] });
  });
});
