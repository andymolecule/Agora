import assert from "node:assert/strict";
import {
  createAuthAgent,
  getAuthAgentByApiKeyHash,
  getAuthAgentByTelegramBotId,
  rotateAuthAgentApiKey,
} from "../queries/auth.js";

const createdRow = {
  id: "11111111-1111-4111-8111-111111111111",
  telegram_bot_id: "bot_123456",
  agent_name: "AUBRAI",
  description: "Longevity research agent",
  api_key_hash: "hash_1",
  last_rotated_at: "2026-03-22T00:00:00.000Z",
  created_at: "2026-03-22T00:00:00.000Z",
  updated_at: "2026-03-22T00:00:00.000Z",
};

let insertedPayload: Record<string, unknown> | null = null;
const insertDb = {
  from(table: string) {
    assert.equal(table, "auth_agents");
    return {
      insert(payload: Record<string, unknown>) {
        insertedPayload = payload;
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              async single() {
                return { data: createdRow, error: null };
              },
            };
          },
        };
      },
    };
  },
} as never;

const created = await createAuthAgent(insertDb, {
  telegramBotId: "bot_123456",
  apiKeyHash: "hash_1",
  agentName: "AUBRAI",
  description: "Longevity research agent",
});
assert.equal(created.id, createdRow.id);
assert.deepEqual(insertedPayload, {
  telegram_bot_id: "bot_123456",
  agent_name: "AUBRAI",
  description: "Longevity research agent",
  api_key_hash: "hash_1",
  last_rotated_at: insertedPayload?.["last_rotated_at"],
  updated_at: insertedPayload?.["updated_at"],
});

let selectedField = "";
let selectedValue = "";
const selectDb = {
  from(table: string) {
    assert.equal(table, "auth_agents");
    return {
      select(selection: string) {
        assert.equal(selection, "*");
        return {
          eq(field: string, value: string) {
            selectedField = field;
            selectedValue = value;
            return this;
          },
          async maybeSingle() {
            return { data: createdRow, error: null };
          },
        };
      },
    };
  },
} as never;

const byTelegramBotId = await getAuthAgentByTelegramBotId(selectDb, "bot_123456");
assert.equal(byTelegramBotId?.telegram_bot_id, "bot_123456");
assert.equal(selectedField, "telegram_bot_id");
assert.equal(selectedValue, "bot_123456");

const byApiKeyHash = await getAuthAgentByApiKeyHash(selectDb, "hash_1");
assert.equal(byApiKeyHash?.api_key_hash, "hash_1");
assert.equal(selectedField, "api_key_hash");
assert.equal(selectedValue, "hash_1");

let updatedPayload: Record<string, unknown> | null = null;
let updatedId = "";
const updateDb = {
  from(table: string) {
    assert.equal(table, "auth_agents");
    return {
      update(payload: Record<string, unknown>) {
        updatedPayload = payload;
        return {
          eq(field: string, value: string) {
            assert.equal(field, "id");
            updatedId = value;
            return {
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async single() {
                    return {
                      data: {
                        ...createdRow,
                        api_key_hash: "hash_2",
                        agent_name: "AUBRAI 2",
                        updated_at: "2026-03-22T01:00:00.000Z",
                        last_rotated_at: "2026-03-22T01:00:00.000Z",
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  },
} as never;

const rotated = await rotateAuthAgentApiKey(updateDb, {
  id: createdRow.id,
  apiKeyHash: "hash_2",
  agentName: "AUBRAI 2",
});
assert.equal(rotated.api_key_hash, "hash_2");
assert.equal(updatedId, createdRow.id);
assert.equal(updatedPayload?.["api_key_hash"], "hash_2");
assert.equal(updatedPayload?.["agent_name"], "AUBRAI 2");
assert.equal(updatedPayload?.["last_rotated_at"], updatedPayload?.["updated_at"]);
assert.equal(updatedPayload?.["description"], undefined);

console.log("auth agent queries passed");
