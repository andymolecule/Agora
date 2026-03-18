"use client";

import { Check, ChevronUp, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { GUIDED_PROMPT_ORDER } from "./guided-prompts";
import { cx } from "./post-ui";
import {
  answerSummaryForPrompt,
  buildManagedIntentFromGuidedState,
  getPromptStatus,
  listReadinessIssues,
  readyUploadCount,
  type GuidedComposerState,
  type GuidedFieldKey,
} from "./guided-state";

const PROMPT_LABELS = new Map<Exclude<GuidedFieldKey, "title">, string>([
  ["problem", "Problem"],
  ["uploads", "Uploads"],
  ["winningCondition", "Winning condition"],
  ["rewardTotal", "Reward"],
  ["distribution", "Payout shape"],
  ["deadline", "Deadline"],
  ["solverInstructions", "Solver instructions"],
]);

function statusLabel(status: ReturnType<typeof getPromptStatus>) {
  switch (status) {
    case "locked":
      return "Locked";
    case "suggested":
      return "Suggested";
    case "collecting":
      return "In progress";
    case "empty":
      return "Empty";
  }
}

function statusTone(status: ReturnType<typeof getPromptStatus>) {
  switch (status) {
    case "locked":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "suggested":
      return "border-accent-200 bg-accent-50 text-accent-700";
    case "collecting":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "empty":
      return "border-warm-200 bg-warm-50 text-warm-600";
  }
}

function FieldRow({
  label,
  value,
  status,
  onEdit,
}: {
  label: string;
  value: string;
  status: ReturnType<typeof getPromptStatus>;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-warm-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-warm-900">{label}</div>
        <span
          className={cx(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
            statusTone(status),
          )}
        >
          {statusLabel(status)}
        </span>
      </div>
      <div className="mt-3 text-sm leading-6 text-warm-700">
        {value || "Not answered yet."}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="mt-3 inline-flex items-center gap-1 rounded-full border border-warm-300 bg-warm-50 px-3 py-1.5 text-xs font-medium text-warm-900 transition hover:bg-white motion-reduce:transition-none"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
    </div>
  );
}

function SummaryContent({
  state,
  onEditPrompt,
  onSetTitle,
}: {
  state: GuidedComposerState;
  onEditPrompt: (field: Exclude<GuidedFieldKey, "title">) => void;
  onSetTitle: (value: string) => void;
}) {
  const intent = buildManagedIntentFromGuidedState(state);
  const readinessIssues = listReadinessIssues(state);
  const [titleDraft, setTitleDraft] = useState(intent.title);
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <div className="space-y-5">
      <div className="rounded-[24px] border border-warm-300 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
              Suggested title
            </div>
            {!editingTitle ? (
              <div className="mt-3 text-xl font-semibold text-warm-900">
                {intent.title || "Title will appear here"}
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  className="min-w-0 flex-1 rounded-[16px] border border-warm-300 bg-warm-50 px-3 py-2 text-sm text-warm-900 outline-none transition focus:border-accent-500 motion-reduce:transition-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSetTitle(titleDraft);
                    setEditingTitle(false);
                  }}
                  className="rounded-full bg-warm-900 px-4 py-2 text-xs font-medium text-white"
                >
                  Save
                </button>
              </div>
            )}
          </div>
          {!editingTitle ? (
            <button
              type="button"
              onClick={() => {
                setTitleDraft(intent.title);
                setEditingTitle(true);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-warm-300 bg-warm-50 px-3 py-1.5 text-xs font-medium text-warm-900 transition hover:bg-white motion-reduce:transition-none"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          ) : null}
        </div>
        <div className="mt-4 text-sm leading-6 text-warm-600">
          Agora auto-suggests a title from the problem statement. You can refine it
          here without changing the guided interview flow.
        </div>
      </div>

      <div className="rounded-[24px] border border-warm-300 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
              Compile readiness
            </div>
            <div className="mt-2 text-lg font-semibold text-warm-900">
              {state.compileState === "ready_to_compile"
                ? "Ready to compile"
                : state.compileState === "compiling"
                  ? "Compiling"
                  : "Needs confirmation"}
            </div>
          </div>
          <div className="rounded-full border border-warm-200 bg-warm-50 px-3 py-1 text-xs font-medium text-warm-700">
            {readyUploadCount(state)} ready file
            {readyUploadCount(state) === 1 ? "" : "s"}
          </div>
        </div>

        {readinessIssues.length > 0 ? (
          <div className="mt-4 space-y-2">
            {readinessIssues.map((issue) => (
              <div
                key={issue}
                className="rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-3 text-sm text-warm-700"
              >
                {issue}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="flex items-start gap-3">
              <Check className="mt-0.5 h-4 w-4" />
              <div>All required answers are confirmed. Generate the review contract when you are ready.</div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {GUIDED_PROMPT_ORDER.map((promptId) => (
          <FieldRow
            key={promptId}
            label={PROMPT_LABELS.get(promptId) ?? promptId}
            value={answerSummaryForPrompt(state, promptId)}
            status={getPromptStatus(state, promptId)}
            onEdit={() => onEditPrompt(promptId)}
          />
        ))}
      </div>
    </div>
  );
}

export function SummaryRail({
  state,
  onEditPrompt,
  onSetTitle,
}: {
  state: GuidedComposerState;
  onEditPrompt: (field: Exclude<GuidedFieldKey, "title">) => void;
  onSetTitle: (value: string) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const readinessIssues = listReadinessIssues(state);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  return (
    <>
      <div className="hidden lg:block lg:sticky lg:top-6">
        <SummaryContent
          state={state}
          onEditPrompt={onEditPrompt}
          onSetTitle={onSetTitle}
        />
      </div>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between gap-3 rounded-full border border-warm-300 bg-white/95 px-5 py-3 shadow-[0_16px_45px_rgba(30,27,24,0.14)]"
        >
          <div className="text-left">
            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
              Draft summary
            </div>
            <div className="mt-1 text-sm font-semibold text-warm-900">
              {readinessIssues.length === 0 ? "Ready to compile" : `${readinessIssues.length} blockers left`}
            </div>
          </div>
          <div className="rounded-full border border-warm-200 bg-warm-50 px-3 py-1 text-xs font-medium text-warm-700">
            {readyUploadCount(state)} files
          </div>
        </button>

        {mobileOpen ? (
          <div
            className="fixed inset-0 z-30 flex items-end bg-warm-900/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          >
            <div
              className="max-h-[88vh] w-full overflow-y-auto rounded-t-[32px] border border-warm-300 bg-warm-100 px-4 pb-8 pt-4 shadow-[0_-24px_80px_rgba(30,27,24,0.16)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-warm-900">
                  Guided draft summary
                </div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex items-center gap-2 rounded-full border border-warm-300 bg-white px-4 py-2 text-sm font-medium text-warm-900"
                >
                  Close
                  <ChevronUp className="h-4 w-4" />
                </button>
              </div>
              <SummaryContent
                state={state}
                onEditPrompt={(field) => {
                  onEditPrompt(field);
                  setMobileOpen(false);
                }}
                onSetTitle={onSetTitle}
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
