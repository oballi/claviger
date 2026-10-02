import { dataUrlToBlob, otpauthName } from "../src/scan/dataUrl";
import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  normalizeRect,
  nudgeSelection,
  toImageRect,
} from "../src/scan/selection";

const VIEW = { w: 400, h: 300 };

describe("normalizeRect", () => {
  it("keeps a forward drag as is", () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 80 }, VIEW)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 60,
    });
  });

  it("handles a reverse drag in both axes", () => {
    expect(normalizeRect({ x: 110, y: 80 }, { x: 10, y: 20 }, VIEW)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 60,
    });
    expect(normalizeRect({ x: 110, y: 20 }, { x: 10, y: 80 }, VIEW)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 60,
    });
  });

  it("clamps points outside the view", () => {
    expect(normalizeRect({ x: -50, y: 250 }, { x: 900, y: 999 }, VIEW)).toEqual({
      x: 0,
      y: 250,
      w: 400,
      h: 50,
    });
    expect(normalizeRect({ x: -5, y: -5 }, { x: -1, y: -1 }, VIEW)).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });
});

describe("toImageRect", () => {
  it("scales view pixels to image pixels", () => {
    expect(toImageRect({ x: 10, y: 20, w: 100, h: 60 }, VIEW, { w: 800, h: 600 })).toEqual({
      x: 20,
      y: 40,
      w: 200,
      h: 120,
    });
  });

  it("rounds outwards on fractional scales", () => {
    expect(toImageRect({ x: 1, y: 1, w: 1, h: 1 }, VIEW, { w: 1000, h: 750 })).toEqual({
      x: 2,
      y: 2,
      w: 3,
      h: 3,
    });
  });

  it("never leaves the image and tolerates a rectangle past the view", () => {
    expect(toImageRect({ x: 300, y: 200, w: 500, h: 500 }, VIEW, { w: 800, h: 600 })).toEqual({
      x: 600,
      y: 400,
      w: 200,
      h: 200,
    });
    expect(toImageRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 }, { w: 800, h: 600 })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });
});

describe("keyboard selection", () => {
  it("starts centred", () => {
    expect(defaultSelection(VIEW)).toEqual({ x: 120, y: 90, w: 160, h: 120 });
  });

  it("moves and resizes inside the view", () => {
    const box = defaultSelection(VIEW);
    expect(nudgeSelection(box, 10, -10, false, VIEW)).toMatchObject({ x: 130, y: 80 });
    expect(nudgeSelection(box, 500, 500, false, VIEW)).toMatchObject({ x: 240, y: 180 });
    expect(nudgeSelection(box, -500, -500, false, VIEW)).toMatchObject({ x: 0, y: 0 });
    expect(nudgeSelection(box, 10, 10, true, VIEW)).toMatchObject({ w: 170, h: 130 });
    expect(nudgeSelection(box, -999, -999, true, VIEW)).toMatchObject({ w: 16, h: 16 });
    expect(nudgeSelection(box, 999, 999, true, VIEW)).toMatchObject({ w: 280, h: 210 });
  });
});

describe("dataUrl helpers", () => {
  it("decodes a base64 data URL to a blob without fetch", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AQID");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("names an otpauth link from its label and issuer", () => {
    expect(otpauthName("otpauth://totp/GitHub:me?secret=AAAA")).toBe("GitHub (me)");
    expect(otpauthName("otpauth://totp/me%40mail.com?secret=AAAA&issuer=Acme")).toBe(
      "Acme (me@mail.com)",
    );
    expect(otpauthName("otpauth://totp/solo?secret=AAAA")).toBe("solo");
    expect(otpauthName("not a url")).toBe("");
  });
});
