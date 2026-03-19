"use client";

import {
  type CompilationResultOutput,
  type PostingSessionOutput,
  parseCsvHeaders,
} from "@agora/common";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../../lib/config";
import { computeProtocolFee } from "../../lib/format";
import {
  computeDeadlineIso,
  getSubmissionDeadlineWindowState,
} from "../../lib/post-submission-window";
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
  ExpertModePanel,
  PostNotice,
  type PostStep,
  PostStepIndicator,
  PostingActionBar,
  PostingModeSection,
  PublishStep,
  ReviewStep,
} from "./PostSections";
import {
  type GuidedCompileState,
  type GuidedFieldKey,
  type ManagedIntentState,
  type UploadedArtifact,
  buildManagedIntentFromGuidedState,
  buildPostingArtifactsFromGuidedState,
  clarificationTargetFromQuestions,
  clearGuidedDraft,
  createInitialGuidedState,
  guidedComposerReducer,
  hydrateGuidedStateFromPostingSession,
  isReadyToCompile,
  listReadinessIssues,
  loadGuidedDraft,
  saveGuidedDraft,
} from "./guided-state";
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
  getFundingSummaryMessage,
  getRewardUnitsFromInput,
  isPermitUnsupportedError,
  usePostFunding,
} from "./post-funding";

type Step = PostStep;
type DeadlineWindowState = ReturnType<typeof getSubmissionDeadlineWindowState>;
type PostingSessionRequestError = Error & { status?: number };

/* ── Utility functions ─────────────────────────────────── */

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

function createPostingSessionRequestError(response: Response, message: string) {
  const error = new Error(message) as PostingSessionRequestError;
  error.name = "PostingSessionRequestError";
  error.status = response.status;
  return error;
}

async function toPostingSessionRequestError(response: Response) {
  return createPostingSessionRequestError(
    response,
    parseApiErrorMessage(await response.text()),
  );
}

function getPostingSessionRequestStatus(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function buildPostingIntent(intent: ManagedIntentState) {
  const disputeWindowInput = intent.disputeWindowHours.trim();
  return {
    title: intent.title,
    description: intent.description,
    payout_condition: intent.payoutCondition,
    reward_total: intent.rewardTotal,
    distribution: intent.distribution,
    deadline: computeDeadlineIso(intent.deadline),
    dispute_window_hours:
      disputeWindowInput.length > 0 ? Number(disputeWindowInput) : undefined,
    domain: intent.domain,
    tags: intent.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    solver_instructions: intent.solverInstructions,
    timezone: intent.timezone,
  };
}

function getDeadlineWindowMessage(state: DeadlineWindowState) {
  switch (state) {
    case "expired":
      return "This compiled submission deadline has already passed. Next step: regenerate the contract to lock a fresh submission window.";
    case "too_close":
      return "This compiled submission deadline is too close to publish safely. Next step: regenerate the contract to refresh the submission window.";
    case "invalid":
      return "This compiled deadline is invalid. Next step: regenerate the contract before publishing.";
    case "ok":
      return null;
  }
}

function buildHostReturnUrl(input: {
  baseUrl: string | null;
  draftId: string;
  challengeId: string;
  specCid: string;
}) {
  if (!input.baseUrl) {
    return null;
  }

  const url = new URL(input.baseUrl);
  url.searchParams.set("agora_event", "challenge_live");
  url.searchParams.set("agora_draft_id", input.draftId);
  url.searchParams.set("agora_challenge_id", input.challengeId);
  url.searchParams.set("agora_spec_cid", input.specCid);
  if (typeof window !== "undefined") {
    url.searchParams.set(
      "agora_challenge_url",
      `${window.location.origin}/challenges/${input.challengeId}`,
    );
  }
  return url.toString();
}

/* ── API helpers ───────────────────────────────────────── */

async function pinDataFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/pin-data", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await toPostingSessionRequestError(response);
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
    throw await toPostingSessionRequestError(response);
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
  const response = await fetch(
    `/api/posting/sessions/${input.sessionId}/compile`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        poster_address: input.posterAddress,
        intent: buildPostingIntent(input.intent),
        uploaded_artifacts: buildPostingArtifactsFromGuidedState(input.uploads),
      }),
    },
  );

  if (!response.ok) {
    throw await toPostingSessionRequestError(response);
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
    throw await toPostingSessionRequestError(response);
  }

  const payload = (await response.json()) as {
    data: { session: PostingSessionOutput };
  };
  return payload.data.session;
}

function getCompilation(session: PostingSessionOutput | null | undefined) {
  return (session?.compilation ?? null) as CompilationResultOutput | null;
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

/* ── Main component ────────────────────────────────────── */

export function PostClient() {
  const searchParams = useSearchParams();
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
  const [postedChallengeId, setPostedChallengeId] = useState<string | null>(
    null,
  );
  const [hostReturnUrl, setHostReturnUrl] = useState<string | null>(null);
  const [hostReturnSource, setHostReturnSource] = useState<
    "requested" | "origin_external_url" | null
  >(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
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
  const hostedDraftId = searchParams.get("draft")?.trim() || null;
  const requestedReturnTo = searchParams.get("return_to")?.trim() || null;
  const isHostedDraftFlow = hostedDraftId !== null;
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
  const isSemiCustomReview =
    session?.state === "needs_review" &&
    !compilation &&
    session.authoring_ir?.routing.mode === "semi_custom";
  const shouldSuggestExpertMode =
    reviewSummary?.recommended_action === "send_to_expert_mode";
  const rewardInput =
    compilation?.challenge_spec.reward.total ?? managedIntent.rewardTotal;
  const deadlineWindowState =
    compilation?.challenge_spec.deadline != null
      ? getSubmissionDeadlineWindowState(compilation.challenge_spec.deadline)
      : null;
  const deadlineWindowMessage =
    deadlineWindowState != null
      ? getDeadlineWindowMessage(deadlineWindowState)
      : null;
  const needsDeadlineRefresh =
    deadlineWindowState === "expired" ||
    deadlineWindowState === "too_close" ||
    deadlineWindowState === "invalid";
  const { feeUsdc, payoutUsdc } = computeProtocolFee(Number(rewardInput || 0));
  const isWrongChain = isConnected && isWrongWalletChain(chainId);
  const publicArtifacts =
    compilation?.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "public",
    ) ?? [];
  const privateArtifacts =
    compilation?.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "private",
    ) ?? [];
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
  const requiresApproval = fundingState.method === "approve" && !allowanceReady;

  /* ── Effects ──────────────────────────────────────────── */

  useEffect(() => {
    if (isHostedDraftFlow) {
      return;
    }
    const restored = loadGuidedDraft();
    if (restored) {
      dispatch({ type: "hydrate", state: restored });
    }
  }, [isHostedDraftFlow]);

  useEffect(() => {
    if (expertMode || isHostedDraftFlow) {
      return;
    }
    saveGuidedDraft(guidedState);
  }, [expertMode, guidedState, isHostedDraftFlow]);

  useEffect(() => {
    const restoreSessionId = hostedDraftId ?? guidedState.sessionId;
    if (!restoreSessionId || session?.id === restoreSessionId) {
      return;
    }

    let cancelled = false;

    void getPostingSession(restoreSessionId)
      .then((restoredSession) => {
        if (cancelled) {
          return;
        }
        setSession(restoredSession);
        dispatch({ type: "set_session_id", sessionId: restoredSession.id });
        if (hostedDraftId) {
          dispatch({
            type: "hydrate",
            state: hydrateGuidedStateFromPostingSession(restoredSession),
          });
        }
        if (restoredSession.state === "ready") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStep(2);
        } else if (restoredSession.state === "needs_review") {
          dispatch({
            type: "set_compile_state",
            compileState: "needs_review",
          });
          setStep(2);
        } else if (restoredSession.state === "needs_clarification") {
          dispatch({
            type: "apply_clarification",
            field: clarificationTargetFromQuestions(
              restoredSession.clarification_questions ?? [],
            ),
          });
          setStep(1);
        } else if (restoredSession.state === "published") {
          dispatch({ type: "set_compile_state", compileState: "ready" });
          setStep(3);
          setStatusMessage(
            "This draft was already pinned and is ready for on-chain publish confirmation.",
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        clearRemotePostingSession(
          getPostingSessionRequestStatus(error) === 404
            ? hostedDraftId
              ? "This linked draft is no longer available. Next step: reopen the host workflow and create a fresh handoff."
              : "Your saved review contract expired. Next step: regenerate the contract from your draft answers."
            : hostedDraftId
              ? "Could not restore the linked draft. Next step: reopen the host workflow and try the publish handoff again."
              : "Could not restore the saved review contract. Next step: regenerate it from your draft answers.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [guidedState.sessionId, hostedDraftId, session?.id]);

  useEffect(() => {
    if (
      !session?.id ||
      session.state !== "needs_review" ||
      isSemiCustomReview
    ) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        const refreshedSession = await getPostingSession(session.id);
        if (cancelled) {
          return;
        }
        setErrorMessage(null);
        if (refreshedSession.state === "needs_review") {
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
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (getPostingSessionRequestStatus(error) === 404) {
          clearRemotePostingSession(
            "This review contract is no longer available. Next step: regenerate it from the draft answers before publishing.",
          );
          return;
        }
        setErrorMessage(
          "Could not refresh operator review status. Next step: wait a moment and refresh the page.",
        );
      }
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [compileReady, isSemiCustomReview, session?.id, session?.state]);

  /* ── Handlers ─────────────────────────────────────────── */

  function resetInterviewForEdit() {
    setStep(1);
    setStatusMessage(null);
    setErrorMessage(null);
    setSession((current) => clearCompiledSessionData(current));
  }

  function dispatchCompileState(compileState: GuidedCompileState) {
    dispatch({ type: "set_compile_state", compileState });
  }

  function clearRemotePostingSession(message: string) {
    setSession(null);
    setHostReturnUrl(null);
    setHostReturnSource(null);
    dispatch({ type: "set_session_id", sessionId: null });
    dispatchCompileState(
      isReadyToCompile(guidedStateRef.current) ? "ready_to_compile" : "idle",
    );
    setStatusMessage(null);
    setErrorMessage(message);
    setStep(1);
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

  function handleSetPostingMode(nextMode: "managed" | "expert") {
    const nextExpertMode = nextMode === "expert";
    if (nextExpertMode === expertMode) {
      return;
    }

    setExpertMode(nextExpertMode);
    setStatusMessage(null);
    setErrorMessage(null);
    setEditingTitle(false);
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
        setStatusMessage(
          `Uploaded ${file.name}. Agora can use it during compile.`,
        );
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
        setErrorMessage(
          error instanceof Error ? error.message : "Upload failed.",
        );
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
          compiledSession.authoring_ir?.routing.mode === "semi_custom"
            ? "This draft is deterministic enough for a semi-custom evaluator, but it does not fit a current managed template."
            : "Agora compiled a contract and queued it for operator review before publish.",
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
      setErrorMessage(
        error instanceof Error ? error.message : "Compile failed.",
      );
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
    if (needsDeadlineRefresh) {
      setErrorMessage(
        deadlineWindowMessage ??
          "This compiled contract needs a fresh submission window before publish.",
      );
      return;
    }

    try {
      setIsPublishing(true);
      setErrorMessage(null);
      setHostReturnUrl(null);
      setHostReturnSource(null);
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
        returnTo: requestedReturnTo ?? undefined,
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
      if (!isHostedDraftFlow) {
        clearGuidedDraft();
      }
      setPostedChallengeId(registration.challengeId);
      const nextHostReturnUrl = buildHostReturnUrl({
        baseUrl: prepared.returnTo,
        draftId: session.id,
        challengeId: registration.challengeId,
        specCid: prepared.specCid,
      });
      setHostReturnUrl(nextHostReturnUrl);
      setHostReturnSource(prepared.returnToSource);
      if (
        nextHostReturnUrl &&
        prepared.returnToSource === "requested" &&
        requestedReturnTo
      ) {
        setStatusMessage(
          "Challenge published successfully. Redirecting back to the host workflow...",
        );
        window.setTimeout(() => {
          window.location.assign(nextHostReturnUrl);
        }, 2_500);
      } else if (nextHostReturnUrl) {
        setStatusMessage(
          "Challenge published successfully. Use the return link to go back to the host workflow.",
        );
      } else {
        setStatusMessage("Challenge published successfully.");
      }
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

  const managedReviewTitle = session?.intent?.title ?? managedIntent.title;

  function handleRefreshCompiledDeadline() {
    resetInterviewForEdit();
    dispatch({ type: "edit_prompt", field: "deadline" });
    setStatusMessage(
      "Submission window unlocked. Reconfirm the deadline and regenerate the contract.",
    );
  }

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24">
      {/* Header */}
      <header className="rounded-[2px] border-2 border-warm-900 bg-white p-6 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
          Agora · Post
        </div>
        <h1 className="mt-3 font-display text-[2.25rem] font-bold leading-[0.95] tracking-[-0.03em] text-warm-900 sm:text-[2.75rem]">
          Create a science bounty
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-6 text-warm-600">
          Describe your problem, upload data, and Agora compiles a deterministic
          scoring contract.
        </p>
      </header>

      <PostingModeSection
        expertMode={expertMode}
        onSetPostingMode={handleSetPostingMode}
      />

      {/* Notices */}
      {statusMessage ? (
        <PostNotice tone="info">{statusMessage}</PostNotice>
      ) : null}
      {errorMessage ? (
        <PostNotice tone="error">{errorMessage}</PostNotice>
      ) : null}
      {postedChallengeId ? (
        <PostNotice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              Challenge published. ID:{" "}
              <span className="font-mono">{postedChallengeId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hostReturnUrl ? (
                <a
                  href={hostReturnUrl}
                  className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider"
                >
                  {hostReturnSource === "requested"
                    ? "Return to host"
                    : "Open host thread"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <Link
                href={`/challenges/${postedChallengeId}`}
                className="btn-secondary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider"
              >
                View challenge
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </PostNotice>
      ) : null}

      {expertMode ? <ExpertModePanel /> : null}

      {!expertMode ? <PostStepIndicator step={step} /> : null}

      {/* ── Step 1: Describe ───────────────────────────── */}
      {!expertMode && step === 1 ? (
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
      ) : null}

      {/* ── Step 2: Review ─────────────────────────────── */}
      {!expertMode && step === 2 && compilation ? (
        <ReviewStep
          compilation={compilation}
          managedTitle={managedReviewTitle}
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          onTitleDraftChange={setTitleDraft}
          onSaveTitle={() => {
            handleTitleChange(titleDraft);
            setEditingTitle(false);
          }}
          onBeginTitleEdit={() => {
            setTitleDraft(managedIntent.title);
            setEditingTitle(true);
          }}
          isReviewQueued={isReviewQueued}
          reviewSummary={reviewSummary}
          shouldSuggestExpertMode={shouldSuggestExpertMode}
          onOpenExpertMode={() => handleSetPostingMode("expert")}
          deadlineWindowMessage={deadlineWindowMessage}
          onRefreshCompiledDeadline={handleRefreshCompiledDeadline}
          publicArtifacts={publicArtifacts}
          privateArtifacts={privateArtifacts}
        />
      ) : null}

      {!expertMode && step === 2 && isSemiCustomReview ? (
        <PostNotice tone="warning">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="font-mono text-xs font-bold uppercase tracking-wider">
                Semi-Custom Evaluator Needed
              </div>
              <p>
                {reviewSummary?.summary ??
                  "This draft is deterministic enough to continue, but it does not map cleanly to a current managed runtime family."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSetPostingMode("expert")}
                className="btn-primary inline-flex items-center gap-2 rounded-[2px] px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider"
              >
                Open Expert Mode
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </PostNotice>
      ) : null}

      {/* ── Step 3: Publish ────────────────────────────── */}
      {!expertMode && step === 3 && compilation ? (
        <PublishStep
          compilation={compilation}
          rewardInput={rewardInput}
          feeUsdc={feeUsdc}
          payoutUsdc={payoutUsdc}
          isConnected={isConnected}
          isWrongChain={isWrongChain}
          wrongChainMessage={getWrongChainMessage(chainId)}
          fundingState={fundingState}
          allowanceReady={allowanceReady}
          balanceReady={balanceReady}
          fundingSummary={fundingSummary}
          deadlineWindowMessage={deadlineWindowMessage}
          onRefreshCompiledDeadline={handleRefreshCompiledDeadline}
        />
      ) : null}

      {/* ── Action bar ─────────────────────────────────── */}
      {!expertMode ? (
        <PostingActionBar
          step={step}
          isCompiling={isCompiling}
          compileReady={compileReady}
          isReviewQueued={isReviewQueued}
          reviewMode={
            isSemiCustomReview
              ? "semi_custom"
              : isReviewQueued
                ? "operator_review"
                : null
          }
          needsDeadlineRefresh={needsDeadlineRefresh}
          isConnected={isConnected}
          isWrongChain={isWrongChain}
          requiresApproval={requiresApproval}
          isApproving={isApproving}
          isPublishing={isPublishing}
          chainName={APP_CHAIN_NAME}
          onBack={() => setStep((current) => (current === 3 ? 2 : 1) as Step)}
          onCompile={() => {
            void handleCompile();
          }}
          onContinueToPublish={() => setStep(3)}
          onOpenExpertMode={() => handleSetPostingMode("expert")}
          onOpenConnect={() => openConnectModal?.()}
          onOpenChain={() => openChainModal?.()}
          onRefreshContract={handleRefreshCompiledDeadline}
          onApprove={() => {
            void handleApprove();
          }}
          onPublish={() => {
            void handlePublish();
          }}
        />
      ) : null}

      {/* Footer */}
      <div className="text-center text-xs text-warm-500">
        Need a custom scorer?{" "}
        <span className="font-mono text-warm-700">
          agora post ./challenge.yaml
        </span>{" "}
        supports advanced configuration from the CLI.
      </div>
    </div>
  );
}
