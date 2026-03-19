import assert from "node:assert/strict";
import test from "node:test";
import {
  getAuthoringDraftOwnershipError,
  normalizePosterAddress,
  resolveAuthoringDraftPosterAddress,
} from "../src/routes/authoring-draft-ownership.js";

test("normalizePosterAddress lowercases non-empty values", () => {
  assert.equal(
    normalizePosterAddress("0xABCDEF0000000000000000000000000000000000"),
    "0xabcdef0000000000000000000000000000000000",
  );
  assert.equal(normalizePosterAddress(""), null);
});

test("ownership check allows unbound sessions", () => {
  assert.equal(
    getAuthoringDraftOwnershipError({
      draftPosterAddress: null,
      requesterAddress: null,
      action: "compile",
    }),
    null,
  );
});

test("ownership check requires the bound wallet for compile", () => {
  const error = getAuthoringDraftOwnershipError({
    draftPosterAddress: "0x00000000000000000000000000000000000000aa",
    requesterAddress: null,
    action: "compile",
  });

  assert.deepEqual(error, {
    status: 401,
    code: "AUTHORING_DRAFT_ADDRESS_REQUIRED",
    message:
      "This authoring draft is already bound to wallet 0x00000000000000000000000000000000000000aa. Next step: reconnect that wallet and retry compile.",
  });
});

test("ownership check rejects a different wallet", () => {
  const error = getAuthoringDraftOwnershipError({
    draftPosterAddress: "0x00000000000000000000000000000000000000aa",
    requesterAddress: "0x00000000000000000000000000000000000000bb",
    action: "publish",
  });

  assert.deepEqual(error, {
    status: 403,
    code: "AUTHORING_DRAFT_ADDRESS_MISMATCH",
    message:
      "This authoring draft belongs to wallet 0x00000000000000000000000000000000000000aa. Next step: switch back to that wallet and retry publish.",
  });
});

test("resolveAuthoringDraftPosterAddress keeps the bound wallet unless a matching requester is provided", () => {
  assert.equal(
    resolveAuthoringDraftPosterAddress({
      draftPosterAddress: "0x00000000000000000000000000000000000000aa",
      requesterAddress: null,
    }),
    "0x00000000000000000000000000000000000000aa",
  );
  assert.equal(
    resolveAuthoringDraftPosterAddress({
      draftPosterAddress: null,
      requesterAddress: "0x00000000000000000000000000000000000000bb",
    }),
    "0x00000000000000000000000000000000000000bb",
  );
});
