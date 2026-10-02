import qrcode from "qrcode-generator";

/** Renders text as a QR code into an RGBA pixel buffer (black on white, quiet zone included). */
export function qrPixels(text: string, cell = 6, margin = 4) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const modules = qr.getModuleCount();
  const size = (modules + margin * 2) * cell;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / cell) - margin;
      const col = Math.floor(x / cell) - margin;
      if (row >= 0 && col >= 0 && row < modules && col < modules && qr.isDark(row, col)) {
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: size, height: size };
}

/** Puts several images side by side on one white canvas. */
export function sideBySide(images: ReturnType<typeof qrPixels>[], gap = 24) {
  const height = Math.max(...images.map((i) => i.height));
  const width = images.reduce((sum, i) => sum + i.width + gap, gap);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let offset = gap;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      const from = y * img.width * 4;
      data.set(img.data.subarray(from, from + img.width * 4), (y * width + offset) * 4);
    }
    offset += img.width + gap;
  }
  return { data, width, height };
}

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    out.push(byte);
  } while (v > 0);
  return out;
}

const bytesField = (field: number, bytes: number[]) => [
  (field << 3) | 2,
  ...varint(bytes.length),
  ...bytes,
];
const intField = (field: number, value: number) => [field << 3, ...varint(value)];
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

/** A Google Authenticator export URI with one TOTP entry per [issuer, name, secret bytes]. */
export function migrationUri(entries: [string, string, number[]][]): string {
  const payload = [
    ...entries.flatMap(([issuer, name, secret]) =>
      bytesField(1, [
        ...bytesField(1, secret),
        ...bytesField(2, utf8(name)),
        ...bytesField(3, utf8(issuer)),
        ...intField(4, 1),
        ...intField(5, 1),
        ...intField(6, 2),
      ]),
    ),
    ...intField(2, 1),
    ...intField(3, 1),
    ...intField(4, 0),
    ...intField(5, 7),
  ];
  return `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(payload).toString("base64"))}`;
}
