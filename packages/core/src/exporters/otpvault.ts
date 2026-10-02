import { z } from "zod";
import { accountDraftSchema, type AccountInput } from "../account/account";
import { openBytes, sealBytes } from "../crypto/aes";
import { DEFAULT_ARGON2 } from "../crypto/kdf";
import { utf8Decode, utf8Encode } from "../encoding/bytes";
import { CoreError } from "../errors";
import { collect, emptyResult, type ImportResult } from "../importers/types";
import type { VaultDeps } from "../ports";
import { isNewerVersion, type VaultGroup } from "../vault/format";
import {
  createPasswordKeyslot,
  keyslotSchema,
  openPasswordKeyslot,
  type PasswordKeyslot,
} from "../vault/keyslot";

export const EXPORT_FORMAT = "otp-vault-export";

const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportId: z.string().min(1),
  createdAt: z.number(),
  keyslots: z.array(keyslotSchema).min(1),
  payload: z.object({ iv: z.string(), ct: z.string() }),
});

// Group fields are parsed leniently: a bad name must never cost the account.
const payloadSchema = z.object({
  accounts: z.array(z.unknown()),
  groups: z.array(z.unknown()).optional(),
});
const groupNameSchema = z.string().max(200);
const payloadAad = (exportId: string) => `otp-vault/v1/export/${exportId}`;

function toPortable(a: AccountInput): AccountInput {
  const { type, secret, issuer, label, algorithm, digits, period, counter, domains } = a;
  return { type, secret, issuer, label, algorithm, digits, period, counter, domains };
}

export async function exportOtpvault(
  accounts: (AccountInput & { groupId?: string })[],
  password: string,
  deps: Pick<VaultDeps, "random" | "clock" | "kdf">,
  groups: VaultGroup[] = [],
): Promise<string> {
  const exportId = deps.random.uuid();
  const fileKey = deps.random.bytes(32);
  const keyslot = await createPasswordKeyslot(
    fileKey,
    password,
    exportId,
    deps.random,
    deps.kdf ?? DEFAULT_ARGON2,
  );
  const names = new Map(groups.map((g) => [g.id, g.name]));
  const body: { accounts: (AccountInput & { group?: string })[]; groups?: string[] } = {
    accounts: accounts.map((a) => {
      const group = a.groupId ? names.get(a.groupId) : undefined;
      return group === undefined ? toPortable(a) : { ...toPortable(a), group };
    }),
  };
  if (groups.length > 0) body.groups = groups.map((g) => g.name);
  const payload = await sealBytes(
    fileKey,
    utf8Encode(JSON.stringify(body)),
    payloadAad(exportId),
    deps.random,
  );
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: 1,
      exportId,
      createdAt: deps.clock.now(),
      keyslots: [keyslot],
      payload,
    },
    null,
    2,
  );
}

export function isOtpvaultExport(json: unknown): boolean {
  return (
    !!json && typeof json === "object" && (json as { format?: unknown }).format === EXPORT_FORMAT
  );
}

export async function parseOtpvaultExport(json: unknown, password: string): Promise<ImportResult> {
  if (isNewerVersion(json, "version"))
    throw new CoreError("unsupported-format", "This export was created by a newer version");
  const file = exportSchema.safeParse(json);
  if (!file.success)
    throw new CoreError("corrupt-file", "Export file is malformed or uses unsafe parameters");
  const slot = file.data.keyslots.find((s): s is PasswordKeyslot => s.kind === "password");
  if (!slot) throw new CoreError("corrupt-file", "Export file has no password keyslot");

  const fileKey = await openPasswordKeyslot(slot, password, file.data.exportId);
  if (!fileKey) throw new CoreError("wrong-password", "Wrong password");
  const plain = await openBytes(fileKey, file.data.payload, payloadAad(file.data.exportId));
  if (!plain) throw new CoreError("corrupt-file", "Export payload failed authentication");

  let body: z.infer<typeof payloadSchema>;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(utf8Decode(plain)));
    if (!parsed.success) throw new Error("bad payload");
    body = parsed.data;
  } catch {
    // No cause attached: the JSON.parse message quotes decrypted plaintext.
    throw new CoreError("corrupt-file", "Export payload is malformed");
  }

  const result = emptyResult();
  const groupNames: (string | undefined)[] = [];
  body.accounts.forEach((raw, position) => {
    const draft = accountDraftSchema.safeParse(raw);
    if (!draft.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const d = draft.data;
    const before = result.accounts.length;
    collect(result, position, d.issuer ? `${d.issuer}: ${d.label ?? ""}` : (d.label ?? ""), d);
    if (result.accounts.length > before) {
      const group = groupNameSchema.safeParse((raw as { group?: unknown }).group);
      groupNames.push(group.success ? group.data : undefined);
    }
  });
  const groups = (body.groups ?? []).slice(0, 200).flatMap((g) => {
    const name = groupNameSchema.safeParse(g);
    return name.success ? [name.data] : [];
  });
  if (groups.length > 0) result.groups = groups;
  if (groupNames.some((g) => g !== undefined)) result.groupNames = groupNames;
  return result;
}
