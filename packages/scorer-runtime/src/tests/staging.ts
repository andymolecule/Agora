import assert from "node:assert/strict";
import { scoreToWad, wadToScore } from "../staging.js";

assert.equal(scoreToWad(0), 0n);
assert.equal(scoreToWad(0.1), 100_000_000_000_000_000n);
assert.equal(scoreToWad(1e-18), 1n);
assert.equal(scoreToWad(6e-19), 1n);
assert.equal(scoreToWad(1e-7), 100_000_000_000n);
assert.equal(scoreToWad(1.2345e3), 1_234_500_000_000_000_000_000n);
assert.equal(scoreToWad(0.30000000000000004), 300_000_000_000_000_040n);
assert.equal(wadToScore(scoreToWad(0.125)), 0.125);
assert.throws(() => scoreToWad(Number.NaN), /Invalid score value/);

console.log("scorer runtime staging checks passed");
