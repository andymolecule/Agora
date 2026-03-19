"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { getChallengeCardFooterLabel } from "../lib/challenge-status-copy";
import { formatUsdc } from "../lib/format";
import type { Challenge } from "../lib/types";

export function ChallengeCard({
  challenge,
}: {
  challenge: Challenge;
  index?: number;
}) {
  const footerLabel = getChallengeCardFooterLabel(challenge);
  const isCancelled = challenge.status?.toLowerCase() === "cancelled";

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="group flex flex-col bg-white p-8 rounded-lg no-underline overflow-hidden h-full hover:shadow-xl transition-all duration-300"
    >
      {/* Top row: domain + time */}
      <div className="flex justify-between items-start mb-6">
        <span
          className="px-3 py-1 rounded-full text-[10px] uppercase font-display"
          style={{
            letterSpacing: "0.1em",
            backgroundColor: "#ebe8e2",
            color: isCancelled ? "#94a3b8" : "#45474a",
          }}
        >
          {challenge.domain?.replace(/_/g, " ")}
        </span>
        <span
          className="flex items-center gap-1 text-xs font-display"
          style={{ color: isCancelled ? "#94a3b8" : "#45474a" }}
        >
          <Clock className="w-3.5 h-3.5" />
          {footerLabel}
        </span>
      </div>

      {/* Title */}
      <h3
        className="font-display text-2xl font-bold leading-tight mb-4 transition-colors duration-200"
        style={{ color: isCancelled ? "#94a3b8" : "#111519" }}
      >
        {challenge.title}
      </h3>

      {/* Description */}
      <p
        className="text-sm line-clamp-2 mb-8 leading-relaxed"
        style={{ color: isCancelled ? "#cbd5e1" : "#45474a" }}
      >
        {challenge.description?.slice(0, 120) ?? "No description."}
      </p>

      {/* Prize section — pushed to bottom */}
      <div className="mt-auto">
        <p
          className="font-display text-xs uppercase mb-1"
          style={{ letterSpacing: "0.05em", color: "#45474a" }}
        >
          Prize Pool
        </p>
        <p
          className="font-mono text-3xl font-bold"
          style={{ color: isCancelled ? "#cbd5e1" : "#111519" }}
        >
          ${formatUsdc(challenge.reward_amount)}{" "}
          <span
            className="text-sm font-normal uppercase"
            style={{ color: isCancelled ? "#cbd5e1" : "#45474a" }}
          >
            USDC
          </span>
        </p>
      </div>
    </Link>
  );
}
