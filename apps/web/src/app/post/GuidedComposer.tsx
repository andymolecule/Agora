"use client";

import { CircleAlert, Loader2, Pencil, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClarificationQuestionOutput } from "@agora/common";
import { GUIDED_PROMPTS, GUIDED_PROMPT_ORDER } from "./guided-prompts";
import { cx, truncateMiddle } from "./post-ui";
import {
  answerSummaryForPrompt,
  buildUploadHintCopy,
  clarificationHelperText,
  clarificationTargetFromQuestions,
  getFieldValue,
  getLastVisitedPromptIndex,
  getPromptStatus,
  readyUploadCount,
  type GuidedComposerState,
  type GuidedFieldKey,
  type UploadedArtifact,
} from "./guided-state";

function UploadEditor({
  uploads,
  onFilesSelected,
  onRenameUpload,
  onRemoveUpload,
  onConfirm,
  disabled,
}: {
  uploads: UploadedArtifact[];
  onFilesSelected: (files: FileList | null) => void;
  onRenameUpload: (id: string, fileName: string) => void;
  onRemoveUpload: (id: string) => void;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const hints = buildUploadHintCopy();
  const [dragActive, setDragActive] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    onFilesSelected(files);
  }

  return (
    <div className="space-y-4">
      <label
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed px-5 py-8 text-center transition motion-reduce:transition-none",
          dragActive
            ? "border-accent-500 bg-white"
            : "border-warm-300 bg-warm-50 hover:border-accent-400 hover:bg-white",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
          }
          setDragActive(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragActive) {
            setDragActive(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud className="h-10 w-10 text-warm-500" />
        <div className="mt-3 text-base font-semibold text-warm-900">
          Drop files here or click to upload
        </div>
        <div className="mt-2 max-w-md text-sm leading-6 text-warm-600">
          Add the data, hidden labels, reference outputs, or evaluation files Agora
          should use during compile.
        </div>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      <div className="space-y-3">
        {uploads.length === 0 ? (
          <div className="rounded-[20px] border border-warm-200 bg-white px-4 py-4 text-sm text-warm-600">
            No files uploaded yet.
          </div>
        ) : (
          uploads.map((artifact) => (
            <div
              key={artifact.id}
              className="rounded-[20px] border border-warm-300 bg-white px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  className={cx(
                    "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                    artifact.status === "ready" &&
                      "bg-emerald-100 text-emerald-800",
                    artifact.status === "uploading" &&
                      "bg-accent-50 text-accent-700",
                    artifact.status === "error" && "bg-red-50 text-red-700",
                  )}
                >
                  {artifact.status}
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveUpload(artifact.id)}
                  className="text-xs font-medium text-warm-500 transition hover:text-warm-900 motion-reduce:transition-none"
                >
                  Remove
                </button>
              </div>

              <label className="mt-3 grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-warm-500">
                  File alias
                </span>
                <input
                  value={artifact.file_name}
                  onChange={(event) => onRenameUpload(artifact.id, event.target.value)}
                  className="rounded-[16px] border border-warm-300 bg-warm-50 px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                />
              </label>

              <div
                className="mt-2 break-all font-mono text-[11px] text-warm-500"
                title={artifact.uri ?? artifact.error ?? "Uploading to IPFS..."}
              >
                {artifact.uri
                  ? truncateMiddle(artifact.uri)
                  : artifact.error ?? "Uploading to IPFS..."}
              </div>

              {artifact.detected_columns?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {artifact.detected_columns.slice(0, 6).map((column) => (
                    <span
                      key={column}
                      className="rounded-full border border-warm-200 bg-warm-50 px-2.5 py-1 font-mono text-[11px] text-warm-700"
                    >
                      {column}
                    </span>
                  ))}
                  {artifact.detected_columns.length > 6 ? (
                    <span className="rounded-full border border-warm-200 bg-warm-50 px-2.5 py-1 font-mono text-[11px] text-warm-700">
                      +{artifact.detected_columns.length - 6} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
        Agora reads file aliases during compile. Good examples:{" "}
        {hints.map(({ hint, trailing }) => (
          <span key={hint}>
            <span className="font-mono">{hint}</span>
            {trailing}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Confirm files
      </button>
    </div>
  );
}

export function GuidedComposer({
  state,
  clarificationQuestions,
  isCompiling,
  onEditPrompt,
  onAnswerPrompt,
  onSkipOptionalPrompt,
  onFilesSelected,
  onRenameUpload,
  onRemoveUpload,
  onConfirmUploads,
}: {
  state: GuidedComposerState;
  clarificationQuestions: ClarificationQuestionOutput[];
  isCompiling: boolean;
  onEditPrompt: (field: Exclude<GuidedFieldKey, "title">) => void;
  onAnswerPrompt: (
    field: Exclude<GuidedFieldKey, "title" | "uploads">,
    value: string,
  ) => void;
  onSkipOptionalPrompt: (field: "solverInstructions") => void;
  onFilesSelected: (files: FileList | null) => void;
  onRenameUpload: (id: string, fileName: string) => void;
  onRemoveUpload: (id: string) => void;
  onConfirmUploads: () => void;
}) {
  const activePromptId = state.activePromptId;
  const lastVisitedIndex = getLastVisitedPromptIndex(state);
  const activePromptIndex = activePromptId
    ? GUIDED_PROMPT_ORDER.indexOf(activePromptId)
    : lastVisitedIndex;
  const clarificationTarget = useMemo(
    () =>
      clarificationQuestions.length > 0
        ? clarificationTargetFromQuestions(clarificationQuestions)
        : null,
    [clarificationQuestions],
  );
  const activeClarifications = useMemo(
    () =>
      clarificationTarget && clarificationTarget === activePromptId
        ? clarificationQuestions
        : [],
    [activePromptId, clarificationQuestions, clarificationTarget],
  );
  const promptRefs = useRef<
    Partial<Record<Exclude<GuidedFieldKey, "title">, HTMLDivElement | null>>
  >({});
  const [draftValue, setDraftValue] = useState("");
  const activePromptValue =
    activePromptId && activePromptId !== "uploads"
      ? (getFieldValue(state, activePromptId) ??
          (activePromptId === "distribution" ? "winner_take_all" : ""))
      : "";

  useEffect(() => {
    if (!activePromptId || activePromptId === "uploads") {
      return;
    }

    setDraftValue(activePromptValue);
  }, [activePromptId, activePromptValue]);

  useEffect(() => {
    if (!activePromptId) {
      return;
    }

    promptRefs.current[activePromptId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activePromptId]);

  return (
    <div className="space-y-4">
      {GUIDED_PROMPT_ORDER.map((promptId, index) => {
        if (index > lastVisitedIndex && promptId !== activePromptId) {
          return null;
        }

        const prompt = GUIDED_PROMPTS[promptId];
        const status = getPromptStatus(state, promptId);
        const isActive = promptId === activePromptId;
        const answer = answerSummaryForPrompt(state, promptId);
        const dimmed = activePromptIndex >= 0 && index > activePromptIndex;
        const submitDisabled =
          prompt.inputKind !== "select" && draftValue.trim().length === 0;
        const hasAnswer =
          status === "locked" ||
          status === "suggested" ||
          (promptId === "uploads" && state.uploads.length > 0);

        return (
          <div
            key={promptId}
            ref={(node) => {
              promptRefs.current[promptId] = node;
            }}
            className={cx(
              "space-y-3 rounded-[28px] border border-warm-300 bg-white/90 p-5 shadow-[0_18px_55px_rgba(30,27,24,0.06)] transition motion-reduce:transition-none",
              isActive && "border-warm-900 shadow-[0_20px_60px_rgba(30,27,24,0.1)]",
              dimmed && "opacity-45",
            )}
          >
            <div className="flex gap-3">
              <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warm-900 text-sm font-semibold text-white">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-3 text-sm leading-6 text-warm-900">
                  {prompt.prompt}
                </div>
                {prompt.helper ? (
                  <div className="mt-2 text-sm leading-6 text-warm-600">
                    {prompt.helper}
                  </div>
                ) : null}
              </div>
            </div>

            {hasAnswer ? (
              <div className="ml-12 rounded-[18px] border border-accent-200 bg-accent-50/80 px-4 py-3 text-sm leading-6 text-warm-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 whitespace-pre-wrap">{answer}</div>
                  {!isActive ? (
                    <button
                      type="button"
                      onClick={() => onEditPrompt(promptId)}
                      className="inline-flex items-center gap-1 rounded-full border border-accent-200 bg-white px-3 py-1 text-xs font-medium text-accent-700 transition hover:bg-accent-50 motion-reduce:transition-none"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {isActive ? (
              <div className="ml-12 space-y-4">
                {activeClarifications.length > 0 ? (
                  <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                    <div className="font-semibold">
                      {clarificationHelperText(clarificationTarget ?? "problem")}
                    </div>
                    <div className="mt-3 space-y-3">
                      {activeClarifications.map((question) => (
                        <div key={question.id}>
                          <div className="font-medium text-warm-900">
                            {question.prompt}
                          </div>
                          <div className="mt-1 text-warm-700">{question.next_step}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {prompt.inputKind === "file" ? (
                  <UploadEditor
                    uploads={state.uploads}
                    onFilesSelected={onFilesSelected}
                    onRenameUpload={onRenameUpload}
                    onRemoveUpload={onRemoveUpload}
                    onConfirm={onConfirmUploads}
                    disabled={
                      readyUploadCount(state) === 0 ||
                      state.uploads.some((artifact) => artifact.status === "uploading")
                    }
                  />
                ) : (
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (promptId === "uploads") {
                        return;
                      }

                      const normalizedValue =
                        prompt.inputKind === "select" ? draftValue : draftValue.trim();
                      if (!normalizedValue) {
                        return;
                      }

                      onAnswerPrompt(promptId, normalizedValue);
                    }}
                  >
                    {prompt.inputKind === "textarea" ? (
                      <textarea
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        rows={5}
                        placeholder={prompt.placeholder}
                        className="w-full rounded-[20px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                      />
                    ) : prompt.inputKind === "currency" ? (
                      <input
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        inputMode="decimal"
                        placeholder={prompt.placeholder}
                        className="w-full rounded-[20px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                      />
                    ) : prompt.inputKind === "date" ? (
                      <input
                        type="datetime-local"
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        className="w-full rounded-[20px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                      />
                    ) : prompt.inputKind === "select" ? (
                      <select
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        className="w-full rounded-[20px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                      >
                        {prompt.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        placeholder={prompt.placeholder}
                        className="w-full rounded-[20px] border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                      />
                    )}

                    {prompt.optional ? (
                      <div className="rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-3 text-sm text-warm-600">
                        You can skip this for now and still compile the managed draft.
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={submitDisabled}
                        className="inline-flex items-center gap-2 rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Continue
                      </button>
                      {prompt.canSkip ? (
                        <button
                          type="button"
                          onClick={() => onSkipOptionalPrompt("solverInstructions")}
                          className="rounded-full border border-warm-300 bg-white px-5 py-3 text-sm font-medium text-warm-900 transition hover:bg-warm-50 motion-reduce:transition-none"
                        >
                          Skip for now
                        </button>
                      ) : null}
                    </div>
                  </form>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {!state.activePromptId ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
          <div className="flex items-start gap-3">
            {isCompiling ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin" /> : null}
            <div>
              <div className="font-semibold">All required answers are locked.</div>
              <div className="mt-1">
                Generate the review contract when you are ready. You can still edit
                any earlier answer from the transcript or summary rail.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {state.compileState === "needs_review" ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
          Agora compiled a contract, but an operator must review it before you can
          publish.
        </div>
      ) : null}

      {state.compileState === "ready" ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
          Agora locked the managed contract. Continue to review the contract
          before funding and publish.
        </div>
      ) : null}

      {state.compileState === "needs_clarification" && clarificationQuestions.length === 0 ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
          Agora needs a little more context before it can lock the challenge
          contract.
        </div>
      ) : null}

      {state.compileState === "idle" && activePromptId && activePromptIndex > 0 ? (
        <div className="rounded-[24px] border border-warm-200 bg-warm-50 px-5 py-4 text-sm leading-6 text-warm-700">
          Edit earlier answers whenever you need. Agora will ask you to reconfirm any
          answers below the one you changed before compile is enabled again.
        </div>
      ) : null}

      {state.uploads.some((artifact) => artifact.status === "error") ? (
        <div className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-800">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-4 w-4" />
            <div>One or more uploads failed. Remove them and upload again before compile.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
