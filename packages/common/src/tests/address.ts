import assert from "node:assert/strict";
import { normalizeOptionalAddress } from "../index.js";

assert.equal(normalizeOptionalAddress("0xAbCd"), "0xabcd");
assert.equal(normalizeOptionalAddress(""), null);
assert.equal(normalizeOptionalAddress(undefined), null);

console.log("address helpers validation passed");
