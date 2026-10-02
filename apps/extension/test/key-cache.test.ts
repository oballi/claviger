import { toBase64 } from "@claviger/core";
import { describe, expect, it } from "vitest";
import { KeyCache, MANUAL_LOCK_KEY, PERSISTED_KEY, SESSION_KEY } from "../src/background/keyCache";
import type { LockPolicy } from "../src/background/settings";
import { memoryPlatform, restartBrowser } from "./helpers/platform";

const dek = Uint8Array.from({ length: 32 }, (_, i) => i);
const NEVER: LockPolicy = { kind: "never" };
const BROWSER_CLOSE: LockPolicy = { kind: "browser-close" };

const bytes = (c: { dek: Uint8Array } | null) => (c ? Array.from(c.dek) : null);

describe("KeyCache", () => {
  it("keeps the key only in session storage for locking policies", async () => {
    const p = memoryPlatform();
    await new KeyCache(p).store(dek, BROWSER_CLOSE);
    expect(p.session.data.get(SESSION_KEY)).toBe(toBase64(dek));
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    const loaded = await new KeyCache(p).loadCandidate();
    expect(bytes(loaded)).toEqual(Array.from(dek));
    expect(loaded?.source).toBe("session");
    expect(await new KeyCache(restartBrowser(p)).loadCandidate()).toBeNull();
  });

  it("persists the key locally (never in sync) only for the never policy", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    expect(p.local.data.get(PERSISTED_KEY)).toBe(toBase64(dek));
    expect(p.sync.data.size).toBe(0);
    const loaded = await new KeyCache(restartBrowser(p)).loadCandidate();
    expect(bytes(loaded)).toEqual(Array.from(dek));
    expect(loaded?.source).toBe("persisted");
    await cache.store(dek, { kind: "timeout", minutes: 15 });
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
  });

  it("returns a leftover persisted key as a candidate and forgetPersisted deletes it", async () => {
    const p = memoryPlatform();
    await new KeyCache(p).store(dek, NEVER);
    const cache = new KeyCache(restartBrowser(p));
    expect((await cache.loadCandidate())?.source).toBe("persisted");
    await cache.forgetPersisted();
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    expect(await cache.loadCandidate()).toBeNull();
  });

  it("honours a manual lock until the browser restarts, even with a persisted key", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    await cache.lock();
    expect(p.session.data.has(SESSION_KEY)).toBe(false);
    expect(p.session.data.get(MANUAL_LOCK_KEY)).toBe(true);
    expect(await cache.loadCandidate()).toBeNull();
    expect(await new KeyCache(restartBrowser(p)).loadCandidate()).not.toBeNull();
    await cache.store(dek, NEVER);
    expect(p.session.data.has(MANUAL_LOCK_KEY)).toBe(false);
  });

  it("honours the manual lock flag even when a session key is present", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    await p.session.set({ [MANUAL_LOCK_KEY]: true });
    expect(await cache.loadCandidate()).toBeNull();
  });

  it("forgets every copy", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    await cache.forget();
    expect(p.session.data.has(SESSION_KEY)).toBe(false);
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    expect(await cache.loadCandidate()).toBeNull();
  });

  it("treats corrupt stored keys as absent", async () => {
    const p = memoryPlatform();
    await p.session.set({ [SESSION_KEY]: "!!not base64!!" });
    expect(await new KeyCache(p).loadCandidate()).toBeNull();
    await p.session.set({ [SESSION_KEY]: 42 });
    expect(await new KeyCache(p).loadCandidate()).toBeNull();
    await p.session.set({ [SESSION_KEY]: toBase64(Uint8Array.from({ length: 31 }, (_, i) => i)) });
    expect(await new KeyCache(p).loadCandidate()).toBeNull();
    await p.session.remove([SESSION_KEY]);
    await p.local.set({ [PERSISTED_KEY]: "!!not base64!!" });
    expect(await new KeyCache(p).loadCandidate()).toBeNull();
    await p.local.set({ [PERSISTED_KEY]: 42 });
    expect(await new KeyCache(p).loadCandidate()).toBeNull();
  });
});
