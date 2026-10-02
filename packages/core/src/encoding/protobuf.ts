import { CoreError } from "../errors";
import { concatBytes } from "./bytes";

export type ProtoField =
  { field: number; wire: 0; value: bigint } | { field: number; wire: 1 | 2 | 5; value: Uint8Array };

const invalid = (message: string) => new CoreError("invalid-protobuf", message);

export function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw invalid("Truncated varint");
    const byte = buf[pos++]!;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [BigInt.asUintN(64, result), pos];
    shift += 7n;
  }
  throw invalid("Varint is longer than 10 bytes");
}

/** Reads the top-level fields of a protobuf message (nested messages come back as `wire: 2` bytes). */
export function readFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    pos = afterTag;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field === 0) throw invalid("Field number 0 is not allowed");
    switch (wire) {
      case 0: {
        const [value, next] = readVarint(buf, pos);
        fields.push({ field, wire: 0, value });
        pos = next;
        break;
      }
      case 2: {
        const [length, start] = readVarint(buf, pos);
        if (length > BigInt(buf.length - start))
          throw invalid("Length-delimited field exceeds buffer");
        const end = start + Number(length);
        fields.push({ field, wire: 2, value: buf.subarray(start, end) });
        pos = end;
        break;
      }
      case 1:
      case 5: {
        const size = wire === 1 ? 8 : 4;
        if (pos + size > buf.length) throw invalid("Truncated fixed-width field");
        fields.push({ field, wire, value: buf.subarray(pos, pos + size) });
        pos += size;
        break;
      }
      default:
        throw invalid(`Unsupported wire type ${wire}`);
    }
  }
  return fields;
}

export function writeVarint(value: bigint | number): Uint8Array {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  do {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    out.push(v === 0n ? byte : byte | 0x80);
  } while (v !== 0n);
  return Uint8Array.from(out);
}

export const fieldVarint = (field: number, value: bigint | number): Uint8Array =>
  concatBytes(writeVarint(BigInt(field) << 3n), writeVarint(value));

export const fieldBytes = (field: number, value: Uint8Array): Uint8Array =>
  concatBytes(writeVarint((BigInt(field) << 3n) | 2n), writeVarint(value.length), value);
