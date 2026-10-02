import { toBase64 } from "@claviger/core";
import { describe, expect, it } from "vitest";
import { KeyCache, MANUAL_LOCK_KEY, PERSISTED_KEY, SESSION_KEY } from "../src/background/keyCache";
import type { LockPolicy } from "../src/background/settings";
import { memoryPlatform, restartBrowser } from "./helpers/platform";

const dek = Uint8Array.from({ length: 32 }, (_, i) => i);
const NEVER: LockPolicy = { kind: "never" };
const BROWSER_CLOSE: LockPolicy = { kind: "browser-close" };

describe("KeyCache", () => {
  it("keeps the key only in session storage for locking policies", async () => {
    const p = memoryPlatform();
    await new KeyCache(p).store(dek, BROWSER_CLOSE);
    expect(p.session.data.get(SESSION_KEY)).toBe(toBase64(dek));
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    expect(Array.from((await new KeyCache(p).load(BROWSER_CLOSE))!)).toEqual(Array.from(dek));
    expect(await new KeyCache(restartBrowser(p)).load(BROWSER_CLOSE)).toBeNull();
  });

  it("persists the key locally (never in sync) only for the never policy", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    expect(p.local.data.get(PERSISTED_KEY)).toBe(toBase64(dek));
    expect(p.sync.data.size).toBe(0);
    expect(Array.from((await new KeyCache(restartBrowser(p)).load(NEVER))!)).toEqual(
      Array.from(dek),
    );
    await cache.store(dek, { kind: "timeout", minutes: 15 });
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
  });

  it("never uses (and deletes) a leftover persisted key when the policy is not never", async () => {
    const p = memoryPlatform();
    await new KeyCache(p).store(dek, NEVER);
    const restarted = restartBrowser(p);
    expect(await new KeyCache(restarted).load(BROWSER_CLOSE)).toBeNull();
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
  });

  it("honours a manual lock until the browser restarts, even with a persisted key", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    await cache.lock();
    expect(p.session.data.has(SESSION_KEY)).toBe(false);
    expect(p.session.data.get(MANUAL_LOCK_KEY)).toBe(true);
    expect(await cache.load(NEVER)).toBeNull();
    expect(await new KeyCache(restartBrowser(p)).load(NEVER)).not.toBeNull();
    await cache.store(dek, NEVER);
    expect(p.session.data.has(MANUAL_LOCK_KEY)).toBe(false);
  });

  it("forgets every copy", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    await cache.forget();
    expect(p.session.data.has(SESSION_KEY)).toBe(false);
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    expect(await cache.load(NEVER)).toBeNull();
  });

  it("treats a corrupt stored key as absent", async () => {
    const p = memoryPlatform();
    await p.session.set({ [SESSION_KEY]: "!!not base64!!" });
    expect(await new KeyCache(p).load(BROWSER_CLOSE)).toBeNull();
    await p.session.set({ [SESSION_KEY]: 42 });
    expect(await new KeyCache(p).load(BROWSER_CLOSE)).toBeNull();
  });

  it("deletes persisted key when loading with non-never policy even if session key is present", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    expect(p.local.data.has(PERSISTED_KEY)).toBe(true);
    expect(p.session.data.has(SESSION_KEY)).toBe(true);
    // Load with different policy should delete persisted key but return session key
    const loaded = await cache.load(BROWSER_CLOSE);
    expect(Array.from(loaded!)).toEqual(Array.from(dek));
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
  });

  it("honours manual lock flag even when session key is present", async () => {
    const p = memoryPlatform();
    const cache = new KeyCache(p);
    await cache.store(dek, NEVER);
    expect(p.session.data.has(SESSION_KEY)).toBe(true);
    // Manually set the lock flag while session key is present
    await p.session.set({ [MANUAL_LOCK_KEY]: true });
    expect(await cache.load(NEVER)).toBeNull();
  });

  it("treats a 31-byte base64-decoded key as corrupt", async () => {
    const p = memoryPlatform();
    const key31 = Uint8Array.from({ length: 31 }, (_, i) => i);
    const encoded31 = toBase64(key31);
    await p.session.set({ [SESSION_KEY]: encoded31 });
    expect(await new KeyCache(p).load(BROWSER_CLOSE)).toBeNull();
  });

  it("treats corrupt persisted key as absent under never policy", async () => {
    const p = memoryPlatform();
    await p.local.set({ [PERSISTED_KEY]: "!!not base64!!" });
    expect(await new KeyCache(p).load(NEVER)).toBeNull();
    await p.local.set({ [PERSISTED_KEY]: 42 });
    expect(await new KeyCache(p).load(NEVER)).toBeNull();
  });
});
