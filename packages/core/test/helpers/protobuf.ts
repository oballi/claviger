import { concatBytes, utf8Encode } from "../../src/encoding/bytes";

export function varint(value: number | bigint): Uint8Array {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Uint8Array.from(out);
}

export function bytesField(field: number, value: Uint8Array | string): Uint8Array {
  const bytes = typeof value === "string" ? utf8Encode(value) : value;
  return concatBytes(varint((field << 3) | 2), varint(bytes.length), bytes);
}

export function intField(field: number, value: number | bigint): Uint8Array {
  return concatBytes(varint(field << 3), varint(value));
}

export interface OtpParametersInput {
  secret: Uint8Array;
  name?: string | Uint8Array;
  issuer?: string;
  algorithm?: number;
  digits?: number;
  type?: number;
  counter?: number | bigint;
}

export function otpParameters(p: OtpParametersInput): Uint8Array {
  return concatBytes(
    bytesField(1, p.secret),
    bytesField(2, p.name ?? ""),
    bytesField(3, p.issuer ?? ""),
    intField(4, p.algorithm ?? 1),
    intField(5, p.digits ?? 1),
    intField(6, p.type ?? 2),
    ...(p.counter !== undefined ? [intField(7, p.counter)] : []),
  );
}

export function migrationPayload(
  entries: Uint8Array[],
  batch = { size: 1, index: 0, id: 42 },
): Uint8Array {
  return concatBytes(
    ...entries.map((e) => bytesField(1, e)),
    intField(2, 1),
    intField(3, batch.size),
    intField(4, batch.index),
    intField(5, batch.id),
  );
}

export function migrationUri(payload: Uint8Array, { percentEncode = true } = {}): string {
  const b64 = Buffer.from(payload).toString("base64");
  return `otpauth-migration://offline?data=${percentEncode ? encodeURIComponent(b64) : b64}`;
}
