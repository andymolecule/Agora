import assert from "node:assert/strict";
import test from "node:test";
import {
  getChallengePostIndexingFailureStatus,
  getChallengePostSuccessStatus,
} from "../src/lib/challenge-post";

const txHash =
  "0xdd60f9f79410607e32fbbf447f91b71a82a7fa52f0b2f5b2f282a3aa8ef5c233";

test("successful challenge post status stays explicitly indexed", () => {
  assert.equal(
    getChallengePostSuccessStatus(txHash),
    `success: Challenge posted. tx=${txHash}. Indexed immediately.`,
  );
});

test("failed challenge registration status includes the next action", () => {
  const message = getChallengePostIndexingFailureStatus(
    txHash,
    "API request failed (503): indexer backlog",
  );

  assert.match(message, /could not register it immediately/i);
  assert.match(message, /wait for the indexer to catch up/i);
  assert.match(message, /retry \/api\/challenges with this tx hash/i);
});
