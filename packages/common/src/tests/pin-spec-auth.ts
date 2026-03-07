import assert from "node:assert/strict";
import {
  computeSpecHash,
  getPinSpecAuthorizationTypedData,
} from "../pin-spec-auth.js";

const spec = {
  title: "Test challenge",
  reward: { total: 10, distribution: "winner_take_all" },
};

const specHash = computeSpecHash(spec);
assert.match(specHash, /^0x[0-9a-f]{64}$/);

const typedData = getPinSpecAuthorizationTypedData({
  chainId: 84532,
  wallet: "0x123400000000000000000000000000000000abcd",
  specHash,
  nonce: "abc123",
});

assert.equal(typedData.domain.name, "Agora");
assert.equal(typedData.domain.chainId, 84532);
assert.equal(typedData.primaryType, "PinSpecAuthorization");
assert.equal(
  typedData.message.wallet,
  "0x123400000000000000000000000000000000abcd",
);
assert.equal(typedData.message.specHash, specHash);
assert.equal(typedData.message.nonce, "abc123");

console.log("pin-spec auth helpers validation passed");
