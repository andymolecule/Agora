"use client";

import { ACTIVE_CONTRACT_VERSION, CHALLENGE_STATUS } from "@agora/common";
import AgoraChallengeAbi from "@agora/common/abi/AgoraChallenge.json";
import { AlertCircle, CheckCircle, Clock, Coins, Gavel, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Abi } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { API_BASE_URL } from "../lib/config";

const abi = AgoraChallengeAbi as unknown as Abi;

interface Props {
  challengeId: string;
  contractAddress: string;
}

interface ClaimableResponse {
  onChainStatus: string;
  contractVersion: number;
  supportedVersion: boolean;
  reviewEndsAt: string | null;
  scoringGraceEndsAt: string | null;
  earliestFinalizeAt: string | null;
  canFinalize: boolean;
  finalizeBlockedReason: string | null;
  claimable: string;
  canClaim: boolean;
}

export function ChallengeActions({
  challengeId,
  contractAddress,
}: Props) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync: writeContract } = useWriteContract();

  const [info, setInfo] = useState<ClaimableResponse | null>(null);
  const [fetchError, setFetchError] = useState<string>("");
  const [actionStatus, setActionStatus] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInfo(null);
    setFetchError("");
  }, [challengeId]);

  // Fetch on-chain status + claimable amount
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function fetchInfo() {
      try {
        if (!cancelled) setFetchError("");
        const params = new URLSearchParams();
        if (address) params.set("address", address);
        if (refreshNonce > 0) params.set("refresh", String(refreshNonce));
        const base = API_BASE_URL.replace(/\/$/, "");
        const query = params.toString();
        const res = await fetch(
          `${base}/api/challenges/${challengeId}/claimable${query ? `?${query}` : ""}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Claimable request failed (${res.status})`);
        }
        const json = (await res.json()) as { data?: ClaimableResponse };
        if (!cancelled) {
          setInfo(json.data ?? null);
          setFetchError("");
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to load challenge actions right now.";
          setFetchError(message);
        }
      }
    }
    fetchInfo();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [challengeId, address, refreshNonce]);

  useEffect(() => {
    if (!challengeId) return;
    setActionStatus("");
    setTxHash("");
  }, [challengeId]);

  if (!info && !fetchError) return null;
  if (!info) {
    return (
      <div className="border border-[var(--border-default)] p-6 bg-white rounded-lg space-y-4">
        <h3 className="text-sm font-bold font-mono tracking-wider uppercase text-[var(--color-warm-900)] flex items-center gap-2">
          <Gavel className="w-4 h-4" strokeWidth={2} /> Challenge Actions
        </h3>
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-3">
            <p>{fetchError || "Unable to load challenge actions right now."}</p>
            <button
              type="button"
              onClick={() => setRefreshNonce((value) => value + 1)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border border-[var(--border-default)] bg-white rounded-md hover:bg-[var(--color-warm-900)] hover:text-white transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isFinalized = info.onChainStatus === CHALLENGE_STATUS.finalized;
  const isCancelled = info.onChainStatus === CHALLENGE_STATUS.cancelled;
  const isDisputed = info.onChainStatus === CHALLENGE_STATUS.disputed;
  const isOpen = info.onChainStatus === CHALLENGE_STATUS.open;
  const claimableUsdc = Number(info.claimable) / 1e6; // USDC has 6 decimals
  const hasClaimable = info.canClaim && claimableUsdc > 0;

  if (isOpen) return null;

  async function assertSupportedVersion() {
    if (!publicClient) {
      throw new Error("Wallet client is not ready.");
    }
    const rawVersion = (await publicClient.readContract({
      address: contractAddress as `0x${string}`,
      abi,
      functionName: "contractVersion",
    })) as bigint;
    const contractVersion = Number(rawVersion);
    if (contractVersion !== ACTIVE_CONTRACT_VERSION) {
      throw new Error(
        `Unsupported challenge contract version ${contractVersion}. Refresh the app and point it at the active v${ACTIVE_CONTRACT_VERSION} runtime.`,
      );
    }
  }

  async function handleFinalize() {
    if (!writeContract || !publicClient) return;
    setLoading(true);
    setActionStatus("Finalizing — confirm in your wallet...");
    try {
      await assertSupportedVersion();
      const hash = await writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "finalize",
        args: [],
      });
      setActionStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setRefreshNonce((value) => value + 1);
      setActionStatus("Finalized ✅");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ChallengeFinalized")) {
        setActionStatus("Already finalized ✅");
      } else if (msg.includes("rejected") || msg.includes("denied")) {
        setActionStatus("Transaction cancelled");
      } else {
        setActionStatus(`Error: ${msg.slice(0, 100)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    if (!writeContract || !publicClient) return;
    setLoading(true);
    setActionStatus("Claiming — confirm in your wallet...");
    try {
      await assertSupportedVersion();
      const hash = await writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "claim",
        args: [],
      });
      setActionStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setRefreshNonce((value) => value + 1);
      setActionStatus("Claimed ✅");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NothingToClaim")) {
        setActionStatus("Nothing to claim");
      } else if (msg.includes("rejected") || msg.includes("denied")) {
        setActionStatus("Transaction cancelled");
      } else {
        setActionStatus(`Error: ${msg.slice(0, 100)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function formatActionDate(value: string | null) {
    if (!value) return "unavailable";
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const reviewEndsDate = formatActionDate(info.reviewEndsAt);
  const scoringGraceDate = formatActionDate(info.scoringGraceEndsAt);
  const earliestFinalizeDate = formatActionDate(info.earliestFinalizeAt);

  return (
    <div className="border border-[var(--border-default)] p-6 bg-white rounded-lg space-y-4">
      <h3 className="text-sm font-bold font-mono tracking-wider uppercase text-[var(--color-warm-900)] flex items-center gap-2">
        <Gavel className="w-4 h-4" strokeWidth={2} /> Challenge Actions
      </h3>

      {fetchError ? (
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)] border-b border-[var(--border-subtle)] pb-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p>{fetchError}</p>
            <button
              type="button"
              onClick={() => setRefreshNonce((value) => value + 1)}
              className="underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {!info.supportedVersion && (
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Unsupported challenge contract version {info.contractVersion}. This
            runtime only supports v{ACTIVE_CONTRACT_VERSION} actions.
          </span>
        </div>
      )}

      {/* Finalize section */}
      {!isFinalized && !isCancelled && !isDisputed && info.supportedVersion && (
        <div className="space-y-2">
          {info.canFinalize ? (
            <>
              <p className="text-xs text-[var(--text-muted)] font-mono">
                Dispute window has passed. Finalization runs automatically, but
                you can trigger it now.
              </p>
              {isConnected ? (
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border border-[var(--border-default)] bg-white rounded-md hover:bg-[var(--color-warm-900)] hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Gavel className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                  Finalize Now
                </button>
              ) : (
                <p className="text-xs text-[var(--text-muted)] font-mono">
                  Connect wallet to finalize
                </p>
              )}
            </>
          ) : info.finalizeBlockedReason === "review_window_active" ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5" />
              Review window ends {reviewEndsDate}. Finalization may take longer if scoring is still incomplete.
            </div>
          ) : info.finalizeBlockedReason === "scoring_incomplete" ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5" />
              Waiting for scorer completion or grace period at {scoringGraceDate}.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
              <Clock className="w-3.5 h-3.5" />
              Earliest finalization check {earliestFinalizeDate}
            </div>
          )}
        </div>
      )}

      {isDisputed && (
        <div className="flex items-start gap-2 text-xs font-mono text-[var(--text-muted)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Payout is on hold while this challenge is disputed.</span>
        </div>
      )}

      {/* Finalized status */}
      {isFinalized && !hasClaimable && (
        <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
          <CheckCircle className="w-3.5 h-3.5 text-green-600" />
          Challenge finalized
          {address ? " — no rewards for this wallet" : ""}
        </div>
      )}

      {/* Cancelled status */}
      {isCancelled && (
        <div className="text-xs font-mono text-[var(--text-muted)]">
          Challenge was cancelled. Funds returned to poster.
        </div>
      )}

      {/* Claim section */}
      {isFinalized && hasClaimable && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)] font-mono">
            You have unclaimed rewards from this challenge.
          </p>
          <button
            type="button"
            onClick={handleClaim}
            disabled={loading}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold font-mono uppercase tracking-wider border-2 border-[var(--color-warm-900)] bg-[#EAB308] text-[var(--color-warm-900)] rounded-md hover:bg-[#CA8A04] transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Coins className="w-4 h-4" strokeWidth={2} />
            )}
            Claim {claimableUsdc.toFixed(2)} USDC
          </button>
        </div>
      )}

      {/* Status message */}
      {actionStatus && (
        <p className="text-xs font-mono text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3 mt-3">
          {actionStatus}
          {txHash && (
            <>
              {" "}
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600"
              >
                View tx ↗
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
