"use client";

import type { AuthoringDraftOutput } from "@agora/common";
import { Check, Loader2, TerminalSquare, X } from "lucide-react";
import { useEffect, useState } from "react";

const REVIEW_TOKEN_STORAGE_KEY = "agora-authoring-review-token";

async function readErrorMessage(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text || "Request failed.";
  }
}

async function fetchReviewDrafts(reviewToken: string) {
  const response = await fetch(
    "/api/authoring-review/drafts?state=needs_review",
    {
      cache: "no-store",
      headers: {
        "x-agora-review-token": reviewToken,
      },
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as {
    data: { drafts: AuthoringDraftOutput[] };
  };
  return payload.data.drafts;
}

async function sendDecision(input: {
  draftId: string;
  reviewToken: string;
  body:
    | { action: "approve" }
    | { action: "send_to_expert_mode" }
    | { action: "reject"; message: string };
}) {
  const response = await fetch(
    `/api/authoring-review/drafts/${input.draftId}/decision`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agora-review-token": input.reviewToken,
      },
      body: JSON.stringify(input.body),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

function formatRuntime(value?: string | null) {
  if (!value) {
    return "Unknown runtime";
  }
  return value
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function ReviewClient() {
  const [drafts, setDrafts] = useState<AuthoringDraftOutput[]>([]);
  const [reviewToken, setReviewToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load(token: string) {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setDrafts(await fetchReviewDrafts(token));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Review queue failed to load.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const savedToken =
      typeof window === "undefined"
        ? ""
        : (window.sessionStorage.getItem(REVIEW_TOKEN_STORAGE_KEY) ?? "");
    if (savedToken) {
      setReviewToken(savedToken);
      void (async () => {
        try {
          setIsLoading(true);
          setErrorMessage(null);
          setDrafts(await fetchReviewDrafts(savedToken));
        } catch (error) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Review queue failed to load.",
          );
        } finally {
          setIsLoading(false);
        }
      })();
      return;
    }
    setIsLoading(false);
  }, []);

  async function handleDecision(
    draftId: string,
    action: "approve" | "reject" | "send_to_expert_mode",
  ) {
    let body:
      | { action: "approve" }
      | { action: "send_to_expert_mode" }
      | { action: "reject"; message: string };

    if (action === "reject") {
      const rejectionMessage =
        window.prompt(
          "Why should this draft be rejected?",
          "Managed authoring cannot safely publish this draft. Next step: revise the challenge draft and recompile.",
        ) ?? "";
      if (rejectionMessage.trim().length === 0) {
        return;
      }
      body = {
        action,
        message: rejectionMessage.trim(),
      };
    } else {
      body = { action };
    }

    try {
      setBusyDraftId(draftId);
      setErrorMessage(null);
      await sendDecision({
        draftId,
        reviewToken,
        body,
      });
      await load(reviewToken);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Decision failed.",
      );
    } finally {
      setBusyDraftId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <section className="rounded-[28px] border border-warm-300 bg-white/90 p-6 shadow-[0_18px_55px_rgba(30,27,24,0.06)]">
        <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
          Internal Queue
        </div>
        <h1 className="mt-2 font-display text-[2.4rem] font-semibold tracking-[-0.04em] text-warm-900">
          Managed authoring review
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-warm-700">
          Review low-confidence managed drafts before they reach the publish
          step. Approve the contract, reject it, or push it back to Expert Mode.
        </p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="password"
            value={reviewToken}
            onChange={(event) => setReviewToken(event.target.value)}
            placeholder="Operator review token"
            className="rounded-full border border-warm-300 bg-white px-4 py-3 text-sm text-warm-900 outline-none transition focus:border-accent-500"
          />
          <button
            type="button"
            onClick={() => {
              const trimmedToken = reviewToken.trim();
              if (typeof window !== "undefined") {
                window.sessionStorage.setItem(
                  REVIEW_TOKEN_STORAGE_KEY,
                  trimmedToken,
                );
              }
              setReviewToken(trimmedToken);
              void load(trimmedToken);
            }}
            disabled={reviewToken.trim().length === 0}
            className="rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Open queue
          </button>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-[22px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-[22px] border border-warm-300 bg-white/90 px-5 py-4 text-sm text-warm-700">
          Loading review queue...
        </div>
      ) : null}

      {!isLoading && reviewToken.trim().length === 0 ? (
        <div className="rounded-[22px] border border-warm-300 bg-white/90 px-5 py-4 text-sm text-warm-700">
          Enter the operator review token to open the queue.
        </div>
      ) : null}

      {!isLoading && reviewToken.trim().length > 0 && drafts.length === 0 ? (
        <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          No drafts are waiting for operator review right now.
        </div>
      ) : null}

      <div className="space-y-5">
        {drafts.map((draft) => {
          const compilation = draft.compilation;
          const busy = busyDraftId === draft.id;
          return (
            <section
              key={draft.id}
              className="rounded-[28px] border border-warm-300 bg-white/90 p-6 shadow-[0_18px_55px_rgba(30,27,24,0.06)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
                    Review draft
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-warm-900">
                    {draft.intent?.title ?? draft.id}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-warm-700">
                    {draft.review_summary?.summary ??
                      "This draft needs operator review before publish."}
                  </p>
                </div>

                <div className="rounded-[20px] border border-warm-200 bg-warm-50 px-4 py-3 text-right text-sm">
                  <div className="text-warm-500">Confidence</div>
                  <div className="mt-1 font-semibold text-warm-900">
                    {draft.review_summary
                      ? `${Math.round(draft.review_summary.confidence_score * 100)}%`
                      : "N/A"}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-[20px] border border-warm-200 bg-warm-50 p-4">
                  <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                    Runtime
                  </div>
                  <div className="mt-2 text-sm font-semibold text-warm-900">
                    {formatRuntime(
                      compilation?.execution_runtime_family ??
                        compilation?.preset_id,
                    )}
                  </div>
                </div>
                <div className="rounded-[20px] border border-warm-200 bg-warm-50 p-4">
                  <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                    Metric
                  </div>
                  <div className="mt-2 text-sm font-semibold text-warm-900">
                    {compilation?.metric ?? "Unknown"}
                  </div>
                </div>
                <div className="rounded-[20px] border border-warm-200 bg-warm-50 p-4">
                  <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                    Dry run
                  </div>
                  <div className="mt-2 text-sm font-semibold text-warm-900">
                    {compilation?.dry_run.sample_score ??
                      compilation?.dry_run.summary ??
                      "Unavailable"}
                  </div>
                </div>
              </div>

              {draft.review_summary?.reason_codes.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {draft.review_summary.reason_codes.map((code) => (
                    <span
                      key={code}
                      className="rounded-full border border-warm-200 bg-warm-50 px-3 py-1 text-xs font-mono uppercase tracking-[0.12em] text-warm-700"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void handleDecision(draft.id, "approve");
                  }}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleDecision(draft.id, "send_to_expert_mode");
                  }}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full border border-warm-300 bg-white px-5 py-3 text-sm font-medium text-warm-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <TerminalSquare className="h-4 w-4" />
                  Send to Expert Mode
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleDecision(draft.id, "reject");
                  }}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Reject
                </button>
              </div>

              {compilation ? (
                <details className="mt-5 rounded-[22px] border border-warm-300 bg-warm-900 text-warm-50">
                  <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold">
                    View compiled contract
                  </summary>
                  <div className="border-t border-white/10 px-4 py-4 text-sm leading-7">
                    <p>{compilation.confirmation_contract.solver_submission}</p>
                    <p className="mt-3">
                      {compilation.confirmation_contract.scoring_summary}
                    </p>
                    <pre className="mt-4 overflow-x-auto rounded-[16px] bg-black/20 p-4 font-mono text-[12px] leading-6 text-warm-100">
                      {JSON.stringify(compilation.challenge_spec, null, 2)}
                    </pre>
                  </div>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
