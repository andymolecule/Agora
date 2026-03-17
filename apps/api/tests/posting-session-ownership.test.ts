import assert from "node:assert/strict";
import test from "node:test";
import {
  getPostingSessionOwnershipError,
  normalizePosterAddress,
  resolvePostingSessionPosterAddress,
} from "../src/routes/posting-session-ownership.js";

test("normalizePosterAddress lowercases non-empty values", () => {
  assert.equal(
    normalizePosterAddress("0xABCDEF0000000000000000000000000000000000"),
    "0xabcdef0000000000000000000000000000000000",
  );
  assert.equal(normalizePosterAddress(""), null);
});

test("ownership check allows unbound sessions", () => {
  assert.equal(
    getPostingSessionOwnershipError({
      sessionPosterAddress: null,
      requesterAddress: null,
      action: "compile",
    }),
    null,
  );
});

test("ownership check requires the bound wallet for compile", () => {
  const error = getPostingSessionOwnershipError({
    sessionPosterAddress: "0x00000000000000000000000000000000000000aa",
    requesterAddress: null,
    action: "compile",
  });

  assert.deepEqual(error, {
    status: 401,
    code: "POSTING_SESSION_ADDRESS_REQUIRED",
    message:
      "This posting session is already bound to wallet 0x00000000000000000000000000000000000000aa. Next step: reconnect that wallet and retry compile.",
  });
});

test("ownership check rejects a different wallet", () => {
  const error = getPostingSessionOwnershipError({
    sessionPosterAddress: "0x00000000000000000000000000000000000000aa",
    requesterAddress: "0x00000000000000000000000000000000000000bb",
    action: "publish",
  });

  assert.deepEqual(error, {
    status: 403,
    code: "POSTING_SESSION_ADDRESS_MISMATCH",
    message:
      "This posting session belongs to wallet 0x00000000000000000000000000000000000000aa. Next step: switch back to that wallet and retry publish.",
  });
});

test("resolvePostingSessionPosterAddress keeps the bound wallet unless a matching requester is provided", () => {
  assert.equal(
    resolvePostingSessionPosterAddress({
      sessionPosterAddress: "0x00000000000000000000000000000000000000aa",
      requesterAddress: null,
    }),
    "0x00000000000000000000000000000000000000aa",
  );
  assert.equal(
    resolvePostingSessionPosterAddress({
      sessionPosterAddress: null,
      requesterAddress: "0x00000000000000000000000000000000000000bb",
    }),
    "0x00000000000000000000000000000000000000bb",
  );
});
