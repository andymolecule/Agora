"use client";

import {
  parseCsvHeaders,
  type CompilationResultOutput,
  type PostingSessionOutput,
} from "@agora/common";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ArrowRight,
  Check,
  Coins,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  Loader2,
  Shield,
  Sparkles,
  TerminalSquare,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { computeProtocolFee, formatUsdc } from "../../lib/format";
import {
  APP_CHAIN_NAME,
  getWrongChainMessage,
  isWrongWalletChain,
} from "../../lib/wallet/network";
import {
  getErrorMessage,
  isUserRejectedError,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";
import { GuidedComposer } from "./GuidedComposer";
import {
  approveUsdc,
  assertFactoryIsSupported,
  createChallengeWithApproval,
  createChallengeWithPermit,
  finalizeManagedChallengePost,
  publishManagedPostingSession,
  signRewardPermit,
} from "./managed-post-flow";
import {
  buildManagedIntentFromGuidedState,
  buildPostingArtifactsFromGuidedState,
  clarificationTargetFromQuestions,
  clearGuidedDraft,
  createInitialGuidedState,
  guidedComposerReducer,
  isReadyToCompile,
  listReadinessIssues,
  loadGuidedDraft,
  saveGuidedDraft,
  type GuidedCompileState,
  type GuidedFieldKey,
  type ManagedIntentState,
  type UploadedArtifact,
} from "./guided-state";
import {
  getFundingSummaryMessage,
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";
import { cx } from "./post-ui";
import { SummaryRail } from "./SummaryRail";

type Step = 1 | 2 | 3;
type NoticeTone = "info" | "success" | "error" | "warning";

const STEP_COPY: Record<
  Step,
  { label: string; title: string; description: string }
> = {
  1: {
    label: "Describe",
    title: "Answer a few focused questions",
    description:
      "Tell Agora what problem to solve, upload the files, and lock the managed draft one answer at a time.",
  },
  2: {
    label: "Confirm",
    title: "Review the generated contract",
    description:
      "Approve the scoring, visibility, and payout contract before you commit money.",
  },
  3: {
    label: "Publish",
    title: "Fund and send it on-chain",
    description:
      "Once the contract looks right, approve funds if needed and publish the challenge.",
  },
};

function toIsoWithOffset(localValue: string) {
  if (!localValue) {
    return new Date().toISOString();
  }
  return new Date(localValue).toISOString();
}

function parseApiErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    return text || "Request failed.";
  }
  return text || "Request failed.";
}

function buildPostingIntent(intent: ManagedIntentState) {
  return {
    title: intent.title,
    description: intent.description,
    payout_condition: intent.payoutCondition,
    reward_total: intent.rewardTotal,
    distribution: intent.distribution,
    deadline: toIsoWithOffset(intent.deadline),
    domain: intent.domain,
    tags: intent.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    solver_instructions: intent.solverInstructions,
    timezone: intent.timezone,
  };
}

function formatRuntimeLabel(value: string) {
  return value
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

async function pinDataFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/pin-data", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }
  return (await response.json()) as { cid: string };
}

async function createPostingSession(input: {
  posterAddress?: `0x${string}`;
  intent: ManagedIntentState;
  uploads: UploadedArtifact[];
}) {
  const response = await fetch("/api/posting/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      poster_address: input.posterAddress,
      intent: buildPostingIntent(input.intent),
      uploaded_artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
    }),
  });

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

async function compilePostingSession(input: {
  sessionId: string;
  posterAddress?: `0x${string}`;
  intent: ManagedIntentState;
  uploads: UploadedArtifact[];
}) {
  const response = await fetch(`/api/posting/sessions/${input.sessionId}/compile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      poster_address: input.posterAddress,
      intent: buildPostingIntent(input.intent),
      uploaded_artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
    }),
  });

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

async function getPostingSession(sessionId: string) {
  const response = await fetch(`/api/posting/sessions/${sessionId}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()));
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

function getCompilation(session: PostingSessionOutput | null | undefined) {
  return (session?.compilation ?? null) as CompilationResultOutput | null;
}

function Notice({
  tone,
  children,
}: {
  tone: NoticeTone;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[20px] border px-4 py-3 text-sm leading-6",
        tone === "info" && "border-accent-200 bg-accent-50 text-accent-700",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "error" && "border-red-200 bg-red-50 text-red-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      {children}
    </div>
  );
}

function SurfaceCard({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-[28px] border border-warm-300 bg-white/90 p-6 shadow-[0_18px_55px_rgba(30,27,24,0.06)]",
        className,
      )}
    >
      <div className="mb-5">
        <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
          {eyebrow}
        </div>
        <h2 className="mt-2 font-display text-[1.85rem] font-semibold leading-tight tracking-[-0.03em] text-warm-900">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function StepRail({ step }: { step: Step }) {
  return (
    <div className="grid gap-3 rounded-[24px] border border-warm-300 bg-white/85 p-3 md:grid-cols-3">
      {(Object.keys(STEP_COPY) as Array<`${Step}`>).map((key) => {
        const current = Number(key) as Step;
        const active = current === step;
        const complete = current < step;
        return (
          <div
            key={key}
            className={cx(
              "rounded-[20px] border px-4 py-4 transition motion-reduce:transition-none",
              active
                ? "border-warm-900 bg-warm-900 text-white"
                : complete
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-warm-300 bg-warm-50 text-warm-700",
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cx(
                  "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold",
                  active
                    ? "border-white/20 bg-white/10 text-white"
                    : complete
                      ? "border-emerald-400 bg-white text-emerald-700"
                      : "border-warm-300 bg-white text-warm-700",
                )}
              >
                {complete ? <Check className="h-4 w-4" /> : current}
              </div>
              <div>
                <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] opacity-70">
                  Step {current}
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {STEP_COPY[current].label}
                </div>
              </div>
            </div>
            <p
              className={cx(
                "mt-3 text-sm leading-6",
                active ? "text-white/82" : "text-inherit/80",
              )}
            >
              {STEP_COPY[current].description}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-warm-200 py-3 text-sm last:border-b-0">
      <span className="text-warm-600">{label}</span>
      <span className="text-right font-medium text-warm-900">{value}</span>
    </div>
  );
}

function ArtifactVisibilityGroup({
  title,
  icon,
  artifacts,
  emptyCopy,
  tone,
}: {
  title: string;
  icon: ReactNode;
  artifacts: CompilationResultOutput["resolved_artifacts"];
  emptyCopy: string;
  tone: "public" | "private";
}) {
  return (
    <div
      className={cx(
        "rounded-[24px] border p-5",
        tone === "public"
          ? "border-accent-200 bg-accent-50/60"
          : "border-warm-300 bg-warm-50",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cx(
            "flex h-10 w-10 items-center justify-center rounded-full",
            tone === "public"
              ? "bg-white text-accent-700"
              : "bg-white text-warm-700",
          )}
        >
          {icon}
        </div>
        <div>
          <div className="text-sm font-semibold text-warm-900">{title}</div>
          <div className="text-xs text-warm-600">
            {artifacts.length} {artifacts.length === 1 ? "file" : "files"}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {artifacts.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-warm-300 px-4 py-3 text-sm text-warm-600">
            {emptyCopy}
          </div>
        ) : (
          artifacts.map((artifact) => (
            <div
              key={`${artifact.role}:${artifact.uri}`}
              className="rounded-[18px] border border-warm-200 bg-white px-4 py-3"
            >
              <div className="text-sm font-medium text-warm-900">
                {artifact.file_name ?? artifact.role}
              </div>
              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-warm-500">
                {artifact.role}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function clearCompiledSessionData(
  current: PostingSessionOutput | null,
): PostingSessionOutput | null {
  if (!current) {
    return current;
  }

  return {
    ...current,
    state: "draft",
    compilation: null,
    clarification_questions: [],
    review_summary: null,
    failure_message: null,
  };
}

export function PostClient() {
  const [step, setStep] = useState<Step>(1);
  const [guidedState, dispatch] = useReducer(
    guidedComposerReducer,
    undefined,
    () => createInitialGuidedState(),
  );
  const [session, setSession] = useState<PostingSessionOutput | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(null);
  const [expertMode, setExpertMode] = useState(false);

  const guidedStateRef = useRef(guidedState);
  useEffect(() => {
    guidedStateRef.current = guidedState;
  }, [guidedState]);

  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();

  const managedIntent = useMemo(
    () => buildManagedIntentFromGuidedState(guidedState),
    [guidedState],
  );
  const compileReady = useMemo(
    () => isReadyToCompile(guidedState),
    [guidedState],
  );
  const draftIssues = useMemo(
    () => listReadinessIssues(guidedState),
    [guidedState],
  );

  const compilation = getCompilation(session);
  const clarificationQuestions = session?.clarification_questions ?? [];
  const reviewSummary = session?.review_summary ?? null;
  const isReviewQueued = session?.state === "needs_review";
  const rewardInput = compilation?.challenge_spec.reward.total ?? managedIntent.rewardTotal;
  const { feeUsdc, payoutUsdc } = computeProtocolFee(Number(rewardInput || 0));
  const isWrongChain = isConnected && isWrongWalletChain(chainId);
  const publicArtifacts =
    compilation?.resolved_artifacts.filter((artifact) => artifact.visibility === "public") ??
    [];
  const privateArtifacts =
    compilation?.resolved_artifacts.filter((artifact) => artifact.visibility === "private") ??
    [];
  const {
    fundingState,
    allowanceReady,
    balanceReady,
    refreshPostingFundingState,
    waitForAllowanceUpdate,
    setFundingState,
  } = usePostFunding({
    showPreview: step === 3,
    walletReady: isConnected && !isWrongChain,
    publicClient,
    address: address as `0x${string}` | undefined,
    factoryAddress: FACTORY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    rewardInput,
  });
  const fundingSummary = getFundingSummaryMessage({
    fundingState,
    balanceReady,
    allowanceReady,
  });

  useEffect(() => {
    const restored = loadGuidedDraft();
    if (restored) {
      dispatch({ type: "hydrate", state: restored });
    }
  }, []);

  useEffect(() => {
    if (expertMode) {
      return;
    }
    saveGuidedDraft(guidedState);
  }, [expertMode, guidedState]);

  useEffect(() => {
    if (!guidedState.sessionId || session) {
      return;
    }

    let cancelled = false;

    void getPostingSession(guidedState.sessionId)
      .then((restoredSession) => {
        if (cancelled) {
          return;
        }
        setSession(restoredSession);
        if (restoredSession.state === "ready") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStep(2);
        } else if (restoredSession.state === "needs_review") {
          dispatch({ type: "set_compile_state", compileState: "needs_review" });
          setStep(2);
        } else if (restoredSession.state === "needs_clarification") {
          dispatch({
            type: "apply_clarification",
            field: clarificationTargetFromQuestions(
              restoredSession.clarification_questions ?? [],
            ),
          });
          setStep(1);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [guidedState.sessionId, session]);

  useEffect(() => {
    if (!session?.id || session.state !== "needs_review") {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        const refreshedSession = await getPostingSession(session.id);
        if (cancelled || refreshedSession.state === "needs_review") {
          return;
        }

        setSession(refreshedSession);

        if (refreshedSession.state === "ready") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStatusMessage(
            "Operator review approved this draft. You can continue to publish now.",
          );
          setErrorMessage(null);
          setStep(2);
          return;
        }

        if (refreshedSession.state === "needs_clarification") {
          dispatch({
            type: "apply_clarification",
            field: clarificationTargetFromQuestions(
              refreshedSession.clarification_questions ?? [],
            ),
          });
          setStatusMessage(
            "Agora needs a little more context before it can lock the challenge contract.",
          );
          setErrorMessage(null);
          setStep(1);
          return;
        }

        if (refreshedSession.state === "failed") {
          dispatch({
            type: "set_compile_state",
            compileState: compileReady ? "ready_to_compile" : "idle",
          });
          setStatusMessage(null);
          setErrorMessage(
            refreshedSession.failure_message ??
              "This draft could not be approved for managed publishing.",
          );
          setStep(1);
        }
      } catch {}
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [compileReady, session?.id, session?.state]);

  function resetInterviewForEdit() {
    setStep(1);
    setStatusMessage(null);
    setErrorMessage(null);
    setSession((current) => clearCompiledSessionData(current));
  }

  function dispatchCompileState(compileState: GuidedCompileState) {
    dispatch({ type: "set_compile_state", compileState });
  }

  function handlePromptAnswer(
    field: Exclude<GuidedFieldKey, "title" | "uploads">,
    value: string,
  ) {
    if (value.trim().length === 0) {
      return;
    }

    resetInterviewForEdit();
    dispatch({ type: "answer_prompt", field, value });
  }

  function handleSkipOptionalPrompt(field: "solverInstructions") {
    resetInterviewForEdit();
    dispatch({ type: "skip_optional_prompt", field });
  }

  function handleEditPrompt(field: Exclude<GuidedFieldKey, "title">) {
    resetInterviewForEdit();
    dispatch({ type: "edit_prompt", field });
  }

  function handleTitleChange(value: string) {
    resetInterviewForEdit();
    dispatch({ type: "set_title", value });
  }

  function updateUploads(nextUploads: UploadedArtifact[]) {
    resetInterviewForEdit();
    dispatch({ type: "set_uploads", uploads: nextUploads });
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const list = Array.from(files);
    for (const file of list) {
      const localId = crypto.randomUUID();
      updateUploads([
        ...guidedStateRef.current.uploads,
        {
          id: localId,
          file_name: file.name,
          mime_type: file.type || undefined,
          size_bytes: file.size,
          status: "uploading",
        },
      ]);

      try {
        const [pinResult, headers] = await Promise.all([
          pinDataFile(file),
          file.type.includes("csv")
            ? file
                .slice(0, 4096)
                .text()
                .then((text) => parseCsvHeaders(text))
            : Promise.resolve([]),
        ]);
        updateUploads(
          guidedStateRef.current.uploads.map((artifact) =>
            artifact.id === localId
              ? {
                  ...artifact,
                  uri: pinResult.cid,
                  detected_columns: headers,
                  status: "ready",
                }
              : artifact,
          ),
        );
        setStatusMessage(`Uploaded ${file.name}. Agora can use it during compile.`);
      } catch (error) {
        updateUploads(
          guidedStateRef.current.uploads.map((artifact) =>
            artifact.id === localId
              ? {
                  ...artifact,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed.",
                }
              : artifact,
          ),
        );
        setErrorMessage(error instanceof Error ? error.message : "Upload failed.");
      }
    }
  }

  function handleRenameUpload(id: string, fileName: string) {
    updateUploads(
      guidedStateRef.current.uploads.map((artifact) =>
        artifact.id === id ? { ...artifact, file_name: fileName } : artifact,
      ),
    );
  }

  function handleRemoveUpload(id: string) {
    updateUploads(
      guidedStateRef.current.uploads.filter((artifact) => artifact.id !== id),
    );
  }

  function handleConfirmUploads() {
    resetInterviewForEdit();
    dispatch({ type: "confirm_uploads" });
  }

  async function handleCompile() {
    if (expertMode) {
      setErrorMessage(
        "Custom scorers still start in the CLI. Next step: switch back to managed mode here, or run `agora post ./challenge.yaml --format json` after preparing your scorer spec.",
      );
      return;
    }

    if (!compileReady) {
      setErrorMessage(
        `This draft is not ready to compile yet. Next step: ${draftIssues[0]}`,
      );
      setStatusMessage(null);
      return;
    }

    try {
      setIsCompiling(true);
      dispatchCompileState("compiling");
      setErrorMessage(null);
      setStatusMessage(
        "Compiling your challenge into a deterministic scoring contract...",
      );

      let existingSessionId = guidedStateRef.current.sessionId;
      if (!existingSessionId) {
        const createdSession = await createPostingSession({
          posterAddress: address as `0x${string}` | undefined,
          intent: managedIntent,
          uploads: guidedStateRef.current.uploads,
        });
        existingSessionId = createdSession.id;
        dispatch({ type: "set_session_id", sessionId: createdSession.id });
      }

      const compiledSession = await compilePostingSession({
        sessionId: existingSessionId,
        posterAddress: address as `0x${string}` | undefined,
        intent: managedIntent,
        uploads: guidedStateRef.current.uploads,
      });
      setSession(compiledSession);
      dispatch({ type: "set_session_id", sessionId: compiledSession.id });

      if (compiledSession.state === "needs_clarification") {
        dispatch({
          type: "apply_clarification",
          field: clarificationTargetFromQuestions(
            compiledSession.clarification_questions ?? [],
          ),
        });
        setStep(1);
        setStatusMessage(
          "Agora needs a little more context before it can lock the challenge contract.",
        );
      } else if (compiledSession.state === "needs_review") {
        dispatchCompileState("needs_review");
        setStep(2);
        setStatusMessage(
          "Agora compiled a contract and queued it for operator review before publish.",
        );
      } else {
        dispatchCompileState("ready");
        setStep(2);
        setStatusMessage(
          "Agora mapped your files, chose a managed runtime, and prepared a review contract.",
        );
      }
    } catch (error) {
      dispatchCompileState(compileReady ? "ready_to_compile" : "idle");
      setErrorMessage(error instanceof Error ? error.message : "Compile failed.");
      setStatusMessage(null);
    } finally {
      setIsCompiling(false);
    }
  }

  async function handleApprove() {
    if (!publicClient || !writeContractAsync || !address) {
      return;
    }

    try {
      setIsApproving(true);
      setErrorMessage(null);
      const rewardUnits = getRewardUnitsFromInput(rewardInput);
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (latestFunding.allowance >= rewardUnits) {
        setStatusMessage("Allowance already covers this reward.");
        return;
      }

      setStatusMessage("Approve USDC in your wallet...");
      const approveTx = await approveUsdc({
        publicClient,
        writeContractAsync,
        address,
        usdcAddress: USDC_ADDRESS,
        factoryAddress: FACTORY_ADDRESS,
        rewardUnits,
      });
      setStatusMessage("Approval submitted. Waiting for confirmation...");
      await waitForTransactionReceiptWithTimeout({
        publicClient,
        hash: approveTx,
      });
      await waitForAllowanceUpdate(rewardUnits);
      setStatusMessage("USDC approved. You can publish the challenge now.");
    } catch (error) {
      setErrorMessage(
        isUserRejectedError(error)
          ? "Approval cancelled."
          : getErrorMessage(error, "Approval failed."),
      );
    } finally {
      setIsApproving(false);
    }
  }

  async function handlePublish() {
    if (!compilation || !publicClient || !writeContractAsync || !address) {
      return;
    }
    if (!session) {
      setErrorMessage("No posting session found. Recompile the draft first.");
      return;
    }

    try {
      setIsPublishing(true);
      setErrorMessage(null);
      const rewardUnits = getRewardUnitsFromInput(
        compilation.challenge_spec.reward.total,
      );
      const latestFunding = await refreshPostingFundingState(rewardUnits);
      if (latestFunding.balance < rewardUnits) {
        throw new Error(latestFunding.message ?? "Insufficient USDC balance.");
      }
      if (
        latestFunding.method === "approve" &&
        latestFunding.allowance < rewardUnits
      ) {
        throw new Error("Approve USDC before publishing this challenge.");
      }

      await assertFactoryIsSupported({
        publicClient,
        factoryAddress: FACTORY_ADDRESS,
      });

      setStatusMessage("Pinning the compiled challenge spec...");
      const prepared = await publishManagedPostingSession({
        sessionId: session.id,
        spec: compilation.challenge_spec,
        address,
        chainId: CHAIN_ID,
        signTypedDataAsync,
      });

      let createTx: `0x${string}`;
      if (
        latestFunding.method === "permit" &&
        latestFunding.allowance < rewardUnits
      ) {
        setStatusMessage(
          `Sign ${latestFunding.tokenName} permit in your wallet...`,
        );
        try {
          const permit = await signRewardPermit({
            publicClient,
            address,
            tokenName: latestFunding.tokenName,
            permitVersion: latestFunding.permitVersion,
            chainId: CHAIN_ID,
            usdcAddress: USDC_ADDRESS,
            factoryAddress: FACTORY_ADDRESS,
            rewardUnits,
            signTypedDataAsync,
          });
          setStatusMessage("Creating the challenge on-chain...");
          createTx = await createChallengeWithPermit({
            publicClient,
            writeContractAsync,
            address,
            factoryAddress: FACTORY_ADDRESS,
            prepared,
            permit,
          });
        } catch (error) {
          const permitMessage = getErrorMessage(
            error,
            "Permit signature failed.",
          );
          if (
            !isUserRejectedError(error) &&
            isPermitUnsupportedError(permitMessage)
          ) {
            setFundingState((current) => ({ ...current, method: "approve" }));
          }
          throw error;
        }
      } else {
        setStatusMessage("Creating the challenge on-chain...");
        createTx = await createChallengeWithApproval({
          publicClient,
          writeContractAsync,
          address,
          factoryAddress: FACTORY_ADDRESS,
          prepared,
        });
      }

      setStatusMessage("Waiting for chain confirmation...");
      const registration = await finalizeManagedChallengePost({
        createTx,
        publicClient,
      });
      clearGuidedDraft();
      setPostedChallengeId(registration.challengeId);
      setStatusMessage("Challenge published successfully.");
    } catch (error) {
      setErrorMessage(
        isUserRejectedError(error)
          ? "Publish cancelled."
          : getErrorMessage(error, "Publish failed."),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  function handleContinue() {
    if (!isConnected && step === 3) {
      openConnectModal?.();
      return;
    }
    if (isWrongChain && step === 3) {
      openChainModal?.();
      return;
    }
    if (step === 1) {
      void handleCompile();
      return;
    }
    if (step === 2) {
      setStep(3);
    }
  }

  function handleToggleExpertMode() {
    setExpertMode((current) => {
      const next = !current;
      setStatusMessage(null);
      setErrorMessage(null);
      setSession(null);
      setStep(1);
      clearGuidedDraft();
      dispatch({ type: "reset" });
      return next;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-28 lg:pb-20">
      <section className="overflow-hidden rounded-[32px] border border-warm-300 bg-[radial-gradient(circle_at_top_left,rgba(47,79,127,0.14),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(217,119,6,0.12),transparent_30%),linear-gradient(135deg,#fffefb,#f5f3ee)] px-6 py-8 shadow-[0_24px_80px_rgba(30,27,24,0.08)] sm:px-8 sm:py-10">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-warm-300 bg-white/85 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-warm-600">
              <Sparkles className="h-3.5 w-3.5 text-accent-600" />
              Guided Authoring
            </div>
            <h1 className="mt-5 max-w-4xl font-display text-[2.9rem] font-semibold leading-[0.92] tracking-[-0.055em] text-warm-900 sm:text-[4.2rem]">
              Post a science bounty through a guided interview.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-warm-700 sm:text-lg">
              Answer one focused question at a time, attach the data, and review
              the scoring contract Agora generates for you. The Docker, bundle,
              and scoring machinery stay behind the curtain.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <span className="rounded-full border border-warm-300 bg-white/90 px-4 py-2 text-sm text-warm-700">
                One answer at a time
              </span>
              <span className="rounded-full border border-warm-300 bg-white/90 px-4 py-2 text-sm text-warm-700">
                Upload the files
              </span>
              <span className="rounded-full border border-warm-300 bg-white/90 px-4 py-2 text-sm text-warm-700">
                Approve the contract
              </span>
            </div>
          </div>

          <div className="rounded-[28px] border border-warm-300 bg-white/88 p-5 shadow-[0_14px_40px_rgba(30,27,24,0.06)]">
            {!expertMode ? (
              <>
                <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
                  Example flow
                </div>
                <div className="mt-3 rounded-[22px] border border-warm-200 bg-warm-50 p-5">
                  <div className="text-xl font-semibold text-warm-900">
                    Predict treatment response from these assay files
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-warm-700">
                      hidden labels
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-warm-700">
                      pay if R² &gt; 0.9
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-warm-700">
                      $500
                    </span>
                  </div>
                </div>
                <div className="mt-4 text-sm leading-6 text-warm-600">
                  Agora turns the answers and files into a deterministic managed
                  contract, then shows you exactly what solvers will see, submit,
                  and get paid on.
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-warm-900 text-white">
                    <TerminalSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
                      Expert Mode
                    </div>
                    <div className="mt-1 text-lg font-semibold text-warm-900">
                      Custom scorers stay CLI-first in this build
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-warm-700">
                  Managed mode is the default. If you need a custom image or a
                  long-tail runtime, prepare the spec in the terminal and post
                  from there.
                </p>
                <div className="mt-4 rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-3 font-mono text-[12px] text-warm-800">
                  agora post ./challenge.yaml --format json
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-warm-300 bg-white/85 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-warm-900">Challenge mode</div>
          <div className="text-sm text-warm-600">
            Use managed mode for the guided path. Switch to expert mode only if
            you need a custom scorer runtime.
          </div>
        </div>
        <button
          type="button"
          onClick={handleToggleExpertMode}
          className={cx(
            "rounded-full px-4 py-2.5 text-sm font-medium transition motion-reduce:transition-none",
            expertMode
              ? "bg-warm-900 text-white"
              : "border border-warm-300 bg-white text-warm-800 hover:bg-warm-50",
          )}
        >
          {expertMode ? "Back to managed mode" : "Switch to expert mode"}
        </button>
      </div>

      {statusMessage ? <Notice tone="info">{statusMessage}</Notice> : null}
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {postedChallengeId ? (
        <Notice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              Challenge published. Challenge ID:{" "}
              <span className="font-mono">{postedChallengeId}</span>
            </div>
            <Link
              href={`/challenges/${postedChallengeId}`}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-50 motion-reduce:transition-none"
            >
              View challenge
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Notice>
      ) : null}

      {expertMode ? (
        <SurfaceCard eyebrow="CLI path" title="When to use expert mode">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[24px] border border-warm-200 bg-warm-50 p-5">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-warm-700" />
                <div className="text-sm font-semibold text-warm-900">
                  Best for custom scorers
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-warm-700">
                Use the CLI when the managed compiler cannot safely map your
                challenge, or when you need your own scorer image and runtime
                settings.
              </p>
            </div>

            <div className="rounded-[24px] border border-warm-300 bg-white p-5">
              <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.24em] text-warm-500">
                Command
              </div>
              <div className="mt-3 rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-3 font-mono text-[12px] text-warm-800">
                agora post ./challenge.yaml --format json
              </div>
              <p className="mt-4 text-sm leading-6 text-warm-700">
                The managed web flow is still the recommended path for
                reproducibility, tabular prediction, docking, and ranking-style
                challenges.
              </p>
            </div>
          </div>
        </SurfaceCard>
      ) : (
        <>
          <StepRail step={step} />

          {step === 1 ? (
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <SurfaceCard eyebrow="Step 1" title={STEP_COPY[1].title}>
                <GuidedComposer
                  state={guidedState}
                  clarificationQuestions={clarificationQuestions}
                  isCompiling={isCompiling}
                  onEditPrompt={handleEditPrompt}
                  onAnswerPrompt={handlePromptAnswer}
                  onSkipOptionalPrompt={handleSkipOptionalPrompt}
                  onFilesSelected={handleFilesSelected}
                  onRenameUpload={handleRenameUpload}
                  onRemoveUpload={handleRemoveUpload}
                  onConfirmUploads={handleConfirmUploads}
                />
              </SurfaceCard>

              <SummaryRail
                state={guidedState}
                onEditPrompt={handleEditPrompt}
                onSetTitle={handleTitleChange}
              />
            </div>
          ) : null}

          {step === 2 && compilation ? (
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <SurfaceCard eyebrow="Step 2" title="Agora's read of the challenge">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-[22px] border border-warm-300 bg-warm-50 p-4">
                    <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                      Runtime family
                    </div>
                    <div className="mt-3 text-lg font-semibold text-warm-900">
                      {formatRuntimeLabel(compilation.runtime_family)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-warm-300 bg-warm-50 p-4">
                    <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                      Metric
                    </div>
                    <div className="mt-3 text-lg font-semibold text-warm-900">
                      {compilation.metric}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-warm-300 bg-warm-50 p-4">
                    <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                      Dry-run sample
                    </div>
                    <div className="mt-3 text-sm font-semibold text-warm-900">
                      {compilation.dry_run.sample_score ?? compilation.dry_run.status}
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-[24px] border border-warm-300 bg-white p-5">
                  <div className="flex items-start gap-3">
                    <FlaskConical className="mt-1 h-5 w-5 text-accent-600" />
                    <div>
                      <div className="text-sm font-semibold text-warm-900">
                        Solvers will submit
                      </div>
                      <p className="mt-2 text-sm leading-6 text-warm-700">
                        {compilation.confirmation_contract.solver_submission}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-[24px] border border-warm-300 bg-white p-5">
                  <div className="flex items-start gap-3">
                    <Shield className="mt-1 h-5 w-5 text-warm-700" />
                    <div>
                      <div className="text-sm font-semibold text-warm-900">
                        Scoring contract
                      </div>
                      <p className="mt-2 text-sm leading-6 text-warm-700">
                        {compilation.confirmation_contract.scoring_summary}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <ArtifactVisibilityGroup
                    title="Visible to solvers"
                    icon={<Eye className="h-5 w-5" />}
                    artifacts={publicArtifacts}
                    emptyCopy="No solver-visible artifacts were resolved."
                    tone="public"
                  />
                  <ArtifactVisibilityGroup
                    title="Hidden for evaluation"
                    icon={<EyeOff className="h-5 w-5" />}
                    artifacts={privateArtifacts}
                    emptyCopy="No private evaluation artifacts were resolved."
                    tone="private"
                  />
                </div>
              </SurfaceCard>

              <SurfaceCard eyebrow="Poster contract" title="Approve this like a marketplace contract">
                <div className="space-y-4">
                  {isReviewQueued && reviewSummary ? (
                    <Notice tone="warning">
                      <div className="space-y-2">
                        <div className="font-semibold text-amber-950">
                          Operator review required before publish
                        </div>
                        <div>{reviewSummary.summary}</div>
                      </div>
                    </Notice>
                  ) : null}

                  <div className="rounded-[22px] border border-warm-300 bg-warm-50 p-4">
                    <div className="text-sm font-semibold text-warm-900">
                      What stays public vs private
                    </div>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-warm-700">
                      {compilation.confirmation_contract.public_private_summary.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-[22px] border border-warm-300 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <Coins className="mt-1 h-5 w-5 text-warm-700" />
                      <div>
                        <div className="text-sm font-semibold text-warm-900">
                          Reward and payout
                        </div>
                        <p className="mt-2 text-sm leading-6 text-warm-700">
                          {compilation.confirmation_contract.reward_summary}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-warm-300 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <FileText className="mt-1 h-5 w-5 text-warm-700" />
                      <div>
                        <div className="text-sm font-semibold text-warm-900">
                          Deadline
                        </div>
                        <p className="mt-2 text-sm leading-6 text-warm-700">
                          {compilation.confirmation_contract.deadline_summary}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-accent-200 bg-accent-50 p-4">
                    <div className="flex items-start gap-3">
                      <Sparkles className="mt-1 h-5 w-5 text-accent-700" />
                      <div>
                        <div className="text-sm font-semibold text-warm-900">
                          Dry-run result
                        </div>
                        <p className="mt-2 text-sm leading-6 text-warm-700">
                          {compilation.confirmation_contract.dry_run_summary}
                        </p>
                      </div>
                    </div>
                  </div>

                  {compilation.warnings.length ? (
                    <Notice tone="warning">
                      {compilation.warnings.join(" ")}
                    </Notice>
                  ) : null}

                  {isReviewQueued && reviewSummary?.reason_codes.length ? (
                    <div className="rounded-[22px] border border-warm-300 bg-white p-4">
                      <div className="text-sm font-semibold text-warm-900">
                        Why it was queued
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {reviewSummary.reason_codes.map((code) => (
                          <span
                            key={code}
                            className="rounded-full border border-warm-200 bg-warm-50 px-3 py-1 text-xs font-mono uppercase tracking-[0.12em] text-warm-700"
                          >
                            {code}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </SurfaceCard>
            </div>
          ) : null}

          {step === 3 && compilation ? (
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <SurfaceCard eyebrow="Step 3" title="Fund and publish the challenge">
                <div className="space-y-5">
                  <div className="rounded-[24px] border border-warm-300 bg-warm-50 p-5">
                    <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-warm-500">
                      Reward summary
                    </div>
                    <div className="mt-3 font-display text-4xl font-semibold tracking-[-0.04em] text-warm-900">
                      {formatUsdc(Number(rewardInput || 0))} USDC
                    </div>
                    <p className="mt-3 text-sm leading-6 text-warm-700">
                      Protocol fee: {formatUsdc(feeUsdc)} USDC. Net payout pool:{" "}
                      {formatUsdc(payoutUsdc)} USDC.
                    </p>
                  </div>

                  <div className="rounded-[24px] border border-warm-300 bg-white p-5">
                    <div className="text-sm font-semibold text-warm-900">
                      Wallet and funding readiness
                    </div>
                    {!isConnected ? (
                      <p className="mt-3 text-sm leading-6 text-warm-700">
                        Connect your wallet to fund and publish the bounty.
                      </p>
                    ) : isWrongChain ? (
                      <p className="mt-3 text-sm leading-6 text-warm-700">
                        {getWrongChainMessage(chainId)}
                      </p>
                    ) : (
                      <div className="mt-4 rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-2">
                        <SummaryRow
                          label="Funding method"
                          value={fundingState.method}
                        />
                        <SummaryRow
                          label="Allowance ready"
                          value={allowanceReady ? "Yes" : "No"}
                        />
                        <SummaryRow
                          label="Balance ready"
                          value={balanceReady ? "Yes" : "No"}
                        />
                      </div>
                    )}

                    <div className="mt-4 rounded-[18px] border border-warm-200 bg-warm-50 px-4 py-3 text-sm leading-6 text-warm-700">
                      {fundingSummary}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {!isConnected ? (
                      <button
                        type="button"
                        onClick={() => openConnectModal?.()}
                        className="inline-flex items-center gap-2 rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white"
                      >
                        <Wallet className="h-4 w-4" />
                        Connect wallet
                      </button>
                    ) : isWrongChain ? (
                      <button
                        type="button"
                        onClick={() => openChainModal?.()}
                        className="rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white"
                      >
                        Switch to {APP_CHAIN_NAME}
                      </button>
                    ) : (
                      <>
                        {fundingState.method === "approve" && !allowanceReady ? (
                          <button
                            type="button"
                            onClick={() => {
                              void handleApprove();
                            }}
                            disabled={isApproving}
                            className="inline-flex items-center gap-2 rounded-full border border-warm-300 bg-white px-5 py-3 text-sm font-medium text-warm-900 transition hover:bg-warm-50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                          >
                            {isApproving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Approve USDC
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            void handlePublish();
                          }}
                          disabled={
                            isPublishing ||
                            (fundingState.method === "approve" && !allowanceReady)
                          }
                          className="inline-flex items-center gap-2 rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPublishing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Publish challenge
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard eyebrow="Final review" title="What goes live when you publish">
                <div className="space-y-4">
                  <div className="rounded-[22px] border border-warm-300 bg-warm-50 p-4">
                    <div className="text-sm font-semibold text-warm-900">
                      Solver contract
                    </div>
                    <div className="mt-2 text-sm leading-6 text-warm-700">
                      {compilation.confirmation_contract.solver_submission}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-warm-300 bg-white p-4">
                    <div className="text-sm font-semibold text-warm-900">
                      Scoring contract
                    </div>
                    <div className="mt-2 text-sm leading-6 text-warm-700">
                      {compilation.confirmation_contract.scoring_summary}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-warm-300 bg-white p-4">
                    <div className="text-sm font-semibold text-warm-900">
                      Visibility contract
                    </div>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-warm-700">
                      {compilation.confirmation_contract.public_private_summary.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <details className="rounded-[22px] border border-warm-300 bg-warm-900 text-warm-50">
                    <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold">
                      Canonical pinned spec preview
                    </summary>
                    <pre className="overflow-x-auto border-t border-white/10 px-4 py-4 font-mono text-[12px] leading-6 text-warm-100">
                      {JSON.stringify(compilation.challenge_spec, null, 2)}
                    </pre>
                  </details>
                </div>
              </SurfaceCard>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-warm-300 bg-white/85 px-5 py-4">
            <div className="text-sm leading-6 text-warm-600">
              {step === 1
                ? "Answer the interview and lock each required answer before Agora compiles the managed contract."
                : step === 2
                  ? isReviewQueued
                    ? "Agora compiled the contract, but an operator must review it before you can fund and publish."
                    : "Read the review contract carefully. This is the promise Agora will enforce."
                  : "Once you publish, the escrow and settlement flow stays the same."}
            </div>

            <div className="flex gap-3">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
                  className="rounded-full border border-warm-300 bg-white px-5 py-3 text-sm font-medium text-warm-900 transition hover:bg-warm-50 motion-reduce:transition-none"
                >
                  Back
                </button>
              ) : null}
              {step < 3 ? (
                step === 2 && isReviewQueued ? (
                  <div className="rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-900">
                    Awaiting operator review
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void handleContinue();
                    }}
                    disabled={isCompiling || (step === 1 && !compileReady)}
                    className="inline-flex items-center gap-2 rounded-full bg-warm-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCompiling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {step === 1 ? "Generate review contract" : "Continue to publish"}
                  </button>
                )
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-warm-300 bg-white/80 p-6 text-sm leading-7 text-warm-600">
            Managed authoring currently supports reproducibility, tabular
            regression, tabular classification, docking, and ranking. If Agora cannot
            confidently map your files into one of those runtimes, it will
            either ask for clarification or queue the draft for operator review
            instead of publishing a broken contract.
          </div>
        </>
      )}
    </div>
  );
}
