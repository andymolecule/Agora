import { ShieldCheck } from "lucide-react";

const TRUST_MODEL_COPY =
  "During the initial phase, scoring is operated by the Agora team. However, scoring is designed to be reproducible: anyone can rerun the same scorer image against the same inputs and verify that the published output matches. Over time, this scorer role will be decentralized.";

interface ScoringTrustNoticeProps {
  compact?: boolean;
}

export function ScoringTrustNotice({
  compact = false,
}: ScoringTrustNoticeProps) {
  return (
    <div className="rounded-xl bg-[#f6f3ed] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
          <ShieldCheck className="h-4 w-4 text-[#111519]" strokeWidth={2.1} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#8c9096]">
            Scoring Trust Model
          </div>
          <p className={`mt-2 leading-relaxed text-[#45474a] ${compact ? "text-sm" : "text-[0.95rem]"}`}>
            {TRUST_MODEL_COPY}
          </p>
        </div>
      </div>
    </div>
  );
}
