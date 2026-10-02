import type { MemoryStorage } from "@claviger/core/testing";

function gate() {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let reached!: () => void;
  const hit = new Promise<void>((r) => (reached = r));
  return { open, release, hit, reached };
}

/** Pauses the first call of `method` whose arguments match, until the returned gate is released. */
export function pauseOnce(
  storage: MemoryStorage,
  method: "get" | "set" | "remove",
  match: (arg: unknown) => boolean,
) {
  const g = gate();
  const original = storage[method].bind(storage) as (arg?: never) => Promise<unknown>;
  let done = false;
  (storage as unknown as Record<string, unknown>)[method] = async (arg?: never) => {
    if (!done && match(arg)) {
      done = true;
      g.reached();
      await g.open;
    }
    return original(arg);
  };
  return g;
}
