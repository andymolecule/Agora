"use client";

import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import type { Abi } from "viem";
import { keccak256, toHex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
    Upload,
    Loader2,
    CheckCircle,
    AlertCircle,
    Wallet,
    ArrowRight,
} from "lucide-react";
import { CHAIN_ID } from "../lib/config";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

interface SubmitSolutionProps {
    challengeAddress: string;
    challengeStatus: string;
    deadline: string;
}

export function SubmitSolution({
    challengeAddress,
    challengeStatus,
    deadline,
}: SubmitSolutionProps) {
    const { address, isConnected, chainId } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync } = useWriteContract();

    const [resultData, setResultData] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState("");
    const [txHash, setTxHash] = useState("");

    const isActive = challengeStatus === "active";
    const isPastDeadline = new Date(deadline).getTime() <= Date.now();
    const canSubmit = isActive && !isPastDeadline;

    if (!canSubmit) {
        return (
            <div className="rounded-lg border border-border-default p-5 bg-surface-default">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-primary">
                    <Upload className="w-4 h-4 text-cobalt-200" />
                    Submit Solution
                </h3>
                <p className="text-sm text-muted">
                    {isPastDeadline
                        ? "Submission deadline has passed."
                        : `This challenge is ${challengeStatus} — submissions are not open.`}
                </p>
            </div>
        );
    }

    const isSuccess = status.startsWith("success:");
    const isError = status && !isSuccess && !isSubmitting;

    async function handleSubmit() {
        if (!isConnected) {
            setStatus("Connect your wallet first.");
            return;
        }
        if (chainId !== CHAIN_ID) {
            setStatus(`Wrong network. Switch to chain ${CHAIN_ID}.`);
            return;
        }
        if (!publicClient) {
            setStatus("Wallet client not ready. Reconnect and retry.");
            return;
        }
        if (!resultData.trim()) {
            setStatus("Enter your result data or result hash.");
            return;
        }

        try {
            setIsSubmitting(true);
            setStatus("Preparing submission...");

            // If the user entered a 0x-prefixed 66-char hex string, use it directly as a bytes32
            // Otherwise, hash the input to get a bytes32
            let resultHash: `0x${string}`;
            if (/^0x[0-9a-fA-F]{64}$/.test(resultData.trim())) {
                resultHash = resultData.trim() as `0x${string}`;
            } else {
                resultHash = keccak256(toHex(resultData.trim()));
            }

            setStatus("Submitting on-chain...");
            const tx = await writeContractAsync({
                account: address,
                address: challengeAddress as `0x${string}`,
                abi: HermesChallengeAbi,
                functionName: "submit",
                args: [resultHash],
            });

            setStatus("Waiting for confirmation...");
            await publicClient.waitForTransactionReceipt({ hash: tx });

            setTxHash(tx);
            setStatus(`success: Submission confirmed! tx=${tx}`);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Submission failed.";
            if (message.includes("DeadlinePassed")) {
                setStatus("Deadline has passed. Cannot submit.");
            } else if (message.includes("InvalidStatus")) {
                setStatus("Challenge is no longer accepting submissions.");
            } else {
                setStatus(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="rounded-lg border border-border-default p-5 bg-surface-default">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-primary">
                <Upload className="w-4 h-4 text-cobalt-200" />
                Submit Solution
            </h3>

            {/* Wallet connection */}
            {!isConnected ? (
                <div className="space-y-3">
                    <p className="text-sm text-secondary">
                        Connect your wallet to submit a solution.
                    </p>
                    <ConnectButton />
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Wallet info */}
                    <div className="flex items-center gap-2 text-xs text-muted">
                        <Wallet className="w-3.5 h-3.5" />
                        <span className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                    </div>

                    {/* Result input */}
                    <div>
                        <label className="block text-xs font-medium text-secondary mb-1.5">
                            Result data or hash
                        </label>
                        <textarea
                            className="w-full px-3 py-2.5 text-sm border border-border-default rounded-md bg-surface-default text-primary placeholder:text-muted font-mono resize-none input-focus"
                            rows={3}
                            placeholder="Enter result data (will be hashed) or a 0x-prefixed bytes32 hash"
                            value={resultData}
                            onChange={(e) => setResultData(e.target.value)}
                            disabled={isSubmitting}
                        />
                        <p className="text-[11px] text-muted mt-1">
                            Plain text will be keccak256-hashed. Paste a <code className="text-[10px]">0x...</code> bytes32 to use directly.
                        </p>
                    </div>

                    {/* Submit button */}
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting || !resultData.trim()}
                        className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {status}
                            </>
                        ) : (
                            <>
                                Submit Solution
                                <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </button>

                    {/* Status messages */}
                    {isSuccess && (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-green-50 border border-green-200 text-green-700 text-sm">
                            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium">Submission confirmed!</p>
                                {txHash && (
                                    <a
                                        href={`https://sepolia.basescan.org/tx/${txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-green-600 underline mt-1 block font-mono"
                                    >
                                        View on Basescan →
                                    </a>
                                )}
                            </div>
                        </div>
                    )}

                    {isError && (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <p className="break-all">{status}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
