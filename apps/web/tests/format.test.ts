import assert from "node:assert/strict";
import test from "node:test";
import { formatUsdcUnits } from "../src/lib/format";

test("formatUsdcUnits preserves large bigint USDC values", () => {
  assert.equal(formatUsdcUnits(1_000_000_000_000_123_456n), "1,000,000,000,000.12");
});
