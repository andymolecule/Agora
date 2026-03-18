import assert from "node:assert/strict";
import test from "node:test";
import {
  clearGuidedDraft,
  createInitialGuidedState,
  getPromptStatus,
  guidedComposerReducer,
  isReadyToCompile,
  loadGuidedDraft,
  saveGuidedDraft,
  type UploadedArtifact,
} from "../src/app/post/guided-state";

function readyUpload(id = "artifact-1"): UploadedArtifact {
  return {
    id,
    uri: `ipfs://${id}`,
    file_name: `${id}.csv`,
    status: "ready",
    detected_columns: ["id", "value"],
  };
}

function buildCompletedDraft() {
  let state = createInitialGuidedState("UTC", Date.parse("2026-03-18T00:00:00.000Z"));
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "problem",
    value: "Predict treatment response from these assay files.",
  });
  state = guidedComposerReducer(state, {
    type: "set_uploads",
    uploads: [readyUpload()],
  });
  state = guidedComposerReducer(state, { type: "confirm_uploads" });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "winningCondition",
    value: "Highest Spearman correlation on the hidden labels wins.",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "rewardTotal",
    value: "500",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "distribution",
    value: "winner_take_all",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "deadline",
    value: "2026-03-25T08:00",
  });
  return state;
}

test("guided reducer advances through the prompt order and becomes compile-ready", () => {
  const state = buildCompletedDraft();

  assert.equal(state.activePromptId, "solverInstructions");
  assert.equal(isReadyToCompile(state), true);
  assert.equal(state.compileState, "ready_to_compile");
  assert.equal(state.fields.title.value, "Predict treatment response from these assay files");
});

test("editing an earlier answer downgrades downstream confirmation state", () => {
  let state = buildCompletedDraft();
  state = guidedComposerReducer(state, {
    type: "edit_prompt",
    field: "problem",
  });

  assert.equal(state.activePromptId, "problem");
  assert.equal(getPromptStatus(state, "problem"), "collecting");
  assert.equal(getPromptStatus(state, "uploads"), "suggested");
  assert.equal(getPromptStatus(state, "winningCondition"), "suggested");
  assert.equal(getPromptStatus(state, "deadline"), "suggested");
  assert.equal(isReadyToCompile(state), false);
});

test("guided drafts persist to and from session storage", () => {
  const state = buildCompletedDraft();
  const storage = new Map<string, string>();
  const mockStorage = {
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  saveGuidedDraft(state, mockStorage);
  const restored = loadGuidedDraft(mockStorage);
  assert.ok(restored);
  assert.equal(restored?.fields.problem.value, state.fields.problem.value);
  assert.equal(restored?.uploads[0]?.uri, "ipfs://artifact-1");

  clearGuidedDraft(mockStorage);
  assert.equal(loadGuidedDraft(mockStorage), null);
});

