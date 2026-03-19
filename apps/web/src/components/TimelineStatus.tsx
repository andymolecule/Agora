"use client";

import {
  CHALLENGE_LIMITS,
  type ChallengeStatus,
} from "@agora/common";
import { ArrowUpRight, Calendar, Clock, ExternalLink } from "lucide-react";
import { getChallengeTimelineFlow } from "../lib/challenge-status-copy";
import { formatDateTime, shortAddress } from "../lib/format";
import type { Challenge, Submission } from "../lib/types";
import { getExplorerAddressUrl } from "../lib/wallet/network";

export function TimelineStatus({
  challenge,
  submissions = [],
}: { challenge: Challenge; submissions?: Submission[] }) {
  const flow: Array<{ key: ChallengeStatus; label: string; detail: string }> =
    getChallengeTimelineFlow(challenge.status);

  const current = flow.findIndex((step) => step.key === challenge.status);

  return (
    <div className="bg-[#f6f3ed] rounded-xl p-6">
      <h3 className="text-xs font-display font-bold uppercase tracking-widest text-[#8c9096] mb-6 flex items-center gap-2">
        <Clock className="w-4 h-4" strokeWidth={2} />
        Timeline
      </h3>

      <div className="relative pl-2">
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-[#e5e2dc]" />

        <div className="space-y-6">
          {flow.map((step, index) => {
            const done = current >= index;
            const isCurrent = current === index;

            return (
              <div key={step.key} className="flex items-start gap-5 relative">
                <div className="relative z-10 w-6 h-6 rounded-full border border-[#e5e2dc] flex items-center justify-center shrink-0 bg-white">
                  {isCurrent ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#111519]" />
                  ) : done ? (
                    <div className="w-2 h-2 rounded-full bg-[#45474a]" />
                  ) : (
                    <div className="w-2 h-2 rounded-full border border-[#c5c6cb]" />
                  )}
                </div>
                <div className="pt-0.5">
                  <div
                    className={`text-sm font-bold font-mono uppercase tracking-wide ${isCurrent ? "text-[#111519]" : "text-[#45474a]"}`}
                  >
                    {step.label}
                  </div>
                  <div
                    className={`text-sm mt-1 ${isCurrent ? "text-[#45474a]" : "text-[#8c9096]"}`}
                  >
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="my-6 border-t border-[#c5c6cb]/15" />

      {/* Meta info */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-sm">
          <Calendar
            className="w-4 h-4 text-[#8c9096]"
            strokeWidth={1.5}
          />
          <span className="text-[#8c9096] font-medium">
            Submission deadline
          </span>
          <span className="ml-auto font-mono font-bold text-[#111519] uppercase tracking-wider text-xs">
            {formatDateTime(challenge.deadline)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Clock
            className="w-4 h-4 text-[#8c9096]"
            strokeWidth={1.5}
          />
          <span className="text-[#8c9096] font-medium">
            Review window
          </span>
          <span className="ml-auto font-mono font-bold text-[#111519] uppercase tracking-wider text-xs">
            {challenge.dispute_window_hours ??
              CHALLENGE_LIMITS.defaultDisputeWindowHours}
            h
          </span>
        </div>
      </div>

      {/* Contract address */}
      {challenge.contract_address && (
        <>
          <div className="my-6 border-t border-[#c5c6cb]/15" />
          <div className="flex items-center gap-3 text-sm">
            <ExternalLink
              className="w-4 h-4 text-[#8c9096]"
              strokeWidth={1.5}
            />
            <span className="text-[#8c9096] font-medium">
              Contract
            </span>
            <a
              href={
                getExplorerAddressUrl(challenge.contract_address) ?? undefined
              }
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto font-mono font-bold text-xs text-[#111519] hover:text-[#2F4F7F] transition-colors underline tabular-nums"
            >
              {shortAddress(challenge.contract_address)}
            </a>
          </div>
        </>
      )}

      {/* On-chain Activity */}
      <div className="my-6 border-t border-[#c5c6cb]/15" />
      <h4 className="text-xs font-display font-bold uppercase tracking-widest text-[#8c9096] mb-4 flex items-center gap-2">
        <ArrowUpRight className="w-4 h-4" strokeWidth={2} />
        On-Chain Activity
      </h4>

      <div className="space-y-3">
        {/* Challenge creation */}
        {challenge.created_at && (
          <div className="flex items-start gap-3 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-[#111519] mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-[#111519]">
                Challenge Created
              </div>
              <div className="text-[#8c9096] font-mono mt-0.5">
                {formatDateTime(challenge.created_at)}
              </div>
            </div>
            {challenge.contract_address && (
              <a
                href={
                  getExplorerAddressUrl(challenge.contract_address) ?? undefined
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8c9096] hover:text-[#2F4F7F] transition-colors shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Submissions */}
        {submissions.map((sub, i) => (
          <div
            key={`${sub.on_chain_sub_id}-${sub.solver_address}-${i}`}
            className="flex items-start gap-3 text-xs"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[#8c9096] mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-[#111519]">
                Submission #{sub.on_chain_sub_id}
              </div>
              <div className="text-[#8c9096] font-mono mt-0.5">
                {shortAddress(sub.solver_address)} ·{" "}
                {formatDateTime(sub.submitted_at)}
              </div>
            </div>
          </div>
        ))}

        {submissions.length === 0 && !challenge.created_at && (
          <div className="text-xs font-mono text-[#8c9096] text-center py-4">
            No activity yet
          </div>
        )}
      </div>
    </div>
  );
}
