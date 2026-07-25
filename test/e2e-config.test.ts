import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultE2ePort, resolveE2ePort } from "../e2e/config-port.js";

test("the E2E fixture port defaults to the standard isolated port", () => {
  assert.equal(resolveE2ePort(undefined), defaultE2ePort);
  assert.equal(resolveE2ePort("  "), defaultE2ePort);
});

test("the E2E fixture port accepts an explicit valid port", () => {
  assert.equal(resolveE2ePort("3492"), 3492);
  assert.equal(resolveE2ePort(" 43871 "), 43871);
});

test("the E2E fixture port rejects malformed and out-of-range values", () => {
  for (const value of ["0", "65536", "-1", "3492junk", "3.5", "NaN"]) {
    assert.throws(() => resolveE2ePort(value), /Invalid WMUX_E2E_PORT/);
  }
});
