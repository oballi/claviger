import { describe, expect, it, vi } from "vitest";
import { Vault } from "../src";
import { makeDeps } from "./helpers/vault";

async function setup() {
  const deps = makeDeps();
  const { vault } = await Vault.create(deps, { password: "pw-test-1", createRecoveryCode: false });
  return { vault, deps };
}

describe("clearSiteMemory (legacy record)", () => {
  it("removes the record without decrypting it", async () => {
    const { vault, deps } = await setup();
    await deps.storage.set({ "vault:sitemem": "not-even-a-record" });
    await vault.clearSiteMemory();
    expect((await deps.storage.get(["vault:sitemem"]))["vault:sitemem"]).toBeUndefined();
  });

  it("is a no-op that writes nothing when the record is absent", async () => {
    const { vault, deps } = await setup();
    const remove = vi.spyOn(deps.storage, "remove");
    await vault.clearSiteMemory();
    expect(remove).not.toHaveBeenCalled();
  });
});
