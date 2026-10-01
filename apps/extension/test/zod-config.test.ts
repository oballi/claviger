import { z } from "zod";
import { expect, it } from "vitest";
import "../src/rpc/protocol";

it("runs zod without eval-based compilation, which the extension CSP forbids", () => {
  expect(z.config().jitless).toBe(true);
});
