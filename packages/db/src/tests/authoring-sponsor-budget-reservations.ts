import assert from "node:assert/strict";
import {
  attachAuthoringSponsorBudgetReservationTx,
  consumeAuthoringSponsorBudgetReservation,
  listStaleAuthoringSponsorBudgetReservations,
  releaseAuthoringSponsorBudgetReservation,
  reserveAuthoringSponsorBudget,
} from "../queries/authoring-sponsor-budget-reservations.js";

const reservationRow = {
  id: "reservation-1",
  session_id: "session-1",
  provider: "beach_science",
  period_start: "2026-03-01T00:00:00.000Z",
  period_end: "2026-04-01T00:00:00.000Z",
  amount_usdc: 10,
  status: "reserved",
  tx_hash: null,
  challenge_id: null,
  reserved_at: "2026-03-20T00:00:00.000Z",
  released_at: null,
  consumed_at: null,
  created_at: "2026-03-20T00:00:00.000Z",
  updated_at: "2026-03-20T00:00:00.000Z",
};

let capturedRpcArgs: Record<string, unknown> | null = null;
const rpcDb = {
  async rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "reserve_authoring_sponsor_budget");
    capturedRpcArgs = args;
    return { data: reservationRow, error: null };
  },
} as never;

const reserved = await reserveAuthoringSponsorBudget(rpcDb, {
  sessionId: "session-1",
  provider: "beach_science",
  periodStart: "2026-03-01T00:00:00.000Z",
  periodEnd: "2026-04-01T00:00:00.000Z",
  amountUsdc: 10,
  budgetLimitUsdc: 500,
});
assert.equal(reserved?.session_id, "session-1");
assert.deepEqual(capturedRpcArgs, {
  p_session_id: "session-1",
  p_provider: "beach_science",
  p_period_start: "2026-03-01T00:00:00.000Z",
  p_period_end: "2026-04-01T00:00:00.000Z",
  p_amount_usdc: 10,
  p_budget_limit_usdc: 500,
});

let capturedUpdateTable = "";
let capturedUpdatePayload: Record<string, unknown> | null = null;
const updateDb = {
  from(table: string) {
    capturedUpdateTable = table;
    return {
      update(payload: Record<string, unknown>) {
        capturedUpdatePayload = payload;
        return {
          eq() {
            return this;
          },
          select() {
            return {
              async maybeSingle() {
                return { data: reservationRow, error: null };
              },
            };
          },
        };
      },
      select() {
        return {
          eq() {
            return this;
          },
          lt() {
            return this;
          },
          order() {
            return this;
          },
          async then() {
            return { data: [reservationRow], error: null };
          },
        };
      },
    };
  },
} as never;

await attachAuthoringSponsorBudgetReservationTx(updateDb, {
  sessionId: "session-1",
  txHash: "0xhash",
});
assert.equal(capturedUpdateTable, "authoring_sponsor_budget_reservations");
assert.equal(capturedUpdatePayload?.["tx_hash"], "0xhash");

await consumeAuthoringSponsorBudgetReservation(updateDb, {
  sessionId: "session-1",
  challengeId: "challenge-1",
  txHash: "0xhash",
});
assert.equal(capturedUpdatePayload?.["status"], "consumed");
assert.equal(capturedUpdatePayload?.["challenge_id"], "challenge-1");

await releaseAuthoringSponsorBudgetReservation(updateDb, {
  sessionId: "session-1",
});
assert.equal(capturedUpdatePayload?.["status"], "released");

const staleDb = {
  from(table: string) {
    assert.equal(table, "authoring_sponsor_budget_reservations");
    return {
      select(selection: string) {
        assert.equal(selection, "*");
        return {
          eq(field: string, value: string) {
            assert.equal(field, "status");
            assert.equal(value, "reserved");
            return this;
          },
          lt(field: string, value: string) {
            assert.equal(field, "updated_at");
            assert.equal(value, "2026-03-20T00:00:00.000Z");
            return this;
          },
          async order(field: string, options: { ascending: boolean }) {
            assert.equal(field, "created_at");
            assert.equal(options.ascending, true);
            return { data: [reservationRow], error: null };
          },
        };
      },
    };
  },
} as never;

const staleReservations = await listStaleAuthoringSponsorBudgetReservations(
  staleDb,
  "2026-03-20T00:00:00.000Z",
);
assert.equal(staleReservations.length, 1);
assert.equal(staleReservations[0]?.provider, "beach_science");

console.log("authoring sponsor budget reservation queries passed");
