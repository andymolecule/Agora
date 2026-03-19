"use client";

import { CHALLENGE_STATUS } from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChallengeCard } from "../components/ChallengeCard";
import { listChallenges } from "../lib/api";
import { type ChallengeListSort, sortChallenges } from "../lib/challenge-list";
import { formatUsdc } from "../lib/format";

const PAGE_SIZE = 15;

/* ── Countdown in Figma format: "14d 06h 22m" ── */
function tableCountdown(deadline: string) {
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return "--";
  if (ms <= 0) return "Closed";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/* ── Domain chip colours ── */
function getDomainStyle(domain: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    longevity: { bg: "#faf5ff", text: "#a855f7", label: "LONGEVITY" },
    drug_discovery: { bg: "#eff6ff", text: "#3b82f6", label: "DRUG DISC." },
    omics: { bg: "#f0fdf4", text: "#22c55e", label: "OMICS" },
    protein_design: { bg: "#f1f5f9", text: "#64748b", label: "PROTEIN" },
    neuroscience: { bg: "#fff7ed", text: "#c2410c", label: "NEUROSCIENCE" },
    other: { bg: "#f8fafc", text: "#94a3b8", label: "OTHER" },
  };
  return map[domain] || { bg: "#f8fafc", text: "#94a3b8", label: domain?.replace(/_/g, " ").toUpperCase() || "OTHER" };
}

/* ── Table status badge ── */
function getTableStatus(status: string, deadline?: string) {
  const rem = deadline ? new Date(deadline).getTime() - Date.now() : Infinity;
  if (status?.toLowerCase() === "open" && rem > 0 && rem < 48 * 3600_000)
    return { dot: "#f97316", text: "#ea580c", label: "ENDING SOON", timeColor: "#ff3b30" };
  const s: Record<string, { dot: string; text: string; label: string; timeColor: string }> = {
    open: { dot: "#10b981", text: "#059669", label: "ACTIVE", timeColor: "#475569" },
    scoring: { dot: "#f59e0b", text: "#d97706", label: "SCORING", timeColor: "#475569" },
    finalized: { dot: "#6b7280", text: "#4b5563", label: "FINALIZED", timeColor: "#cbd5e1" },
    disputed: { dot: "#ef4444", text: "#dc2626", label: "DISPUTED", timeColor: "#475569" },
    cancelled: { dot: "#cbd5e1", text: "#94a3b8", label: "CANCELLED", timeColor: "#cbd5e1" },
  };
  return s[status?.toLowerCase()] || { dot: "#cbd5e1", text: "#94a3b8", label: status?.toUpperCase() ?? "—", timeColor: "#475569" };
}

/* ── CountUp ── */
function CountUp({ target, prefix = "", duration = 800 }: { target: number; prefix?: string; duration?: number }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || target === 0) { setValue(target); return; }
    started.current = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setValue(Math.round((1 - (1 - p) ** 3) * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return <span>{prefix}{value.toLocaleString()}</span>;
}

/* ═══════════════════════════════════════════
   HomeClient
   ═══════════════════════════════════════════ */
export function HomeClient() {
  const [sort, setSort] = useState<ChallengeListSort>("newest");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "grid">("table");

  const query = useQuery({ queryKey: ["challenges"], queryFn: () => listChallenges({}) });
  const challenges = query.data ?? [];

  const openCount = challenges.filter((c) => c.status?.toLowerCase() === CHALLENGE_STATUS.open).length;
  const totalPool = challenges.reduce((s, c) => s + Number(c.reward_amount || 0), 0);
  const totalSubs = challenges.reduce((s, c) => s + (c.submissions_count ?? 0), 0);

  const rows = useMemo(() => {
    return sortChallenges([...challenges], sort);
  }, [challenges, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-10">
      {/* ═══ HERO ═══ */}
      <section
        className="overflow-hidden flex flex-col md:flex-row items-center gap-8 md:gap-12"
        style={{ backgroundColor: "#f6f3ed", borderRadius: "20px", padding: "48px" }}
      >
        <div className="flex-1 max-w-xl">
          <h1
            className="font-display font-bold leading-[0.95] tracking-tight text-4xl md:text-5xl lg:text-[4.5rem]"
            style={{ color: "#111519" }}
          >
            Accelerate<br />Science<br />Bounties
          </h1>
          <p className="mt-6 font-sans leading-relaxed text-base md:text-lg lg:text-xl" style={{ color: "#45474a" }}>
            The open marketplace for precision scientific challenges. Solve the
            world&apos;s hardest problems, earn USDC, and advance human knowledge.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/post"
              className="inline-flex items-center gap-2 px-7 py-3.5 font-sans font-bold text-base no-underline transition-all duration-200 hover:opacity-90"
              style={{ background: "linear-gradient(145deg, #111519, #25292e)", borderRadius: "12px", color: "#ffffff" }}
            >
              <Sparkles className="w-4 h-4" />
              Post Bounty
            </Link>
            <button
              type="button"
              className="px-7 py-3.5 font-sans font-bold text-base transition-all duration-200 hover:opacity-80"
              style={{ backgroundColor: "#e5e2dc", color: "#111519", borderRadius: "12px" }}
            >
              How it works
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center md:justify-end min-w-0 max-w-[200px] sm:max-w-[260px] md:max-w-[340px] lg:max-w-[400px] xl:max-w-[450px]" style={{ marginTop: "-40px", marginBottom: "0px" }}>
          <img
            src="/badger-hero.png"
            alt="Agora mascot"
            className="w-full h-auto object-contain"
            style={{ maxHeight: "600px" }}
          />
        </div>
      </section>

      {/* ═══ KPI STRIP ═══ */}
      <section className="rounded-2xl py-10 px-8 grid grid-cols-3" style={{ backgroundColor: "#f9f8f4" }}>
        <div className="text-center px-8 border-r" style={{ borderColor: "#e0ddd7" }}>
          <div className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "#45474a" }}>Total Bounties</div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "3rem", color: "#111519" }}>
            <CountUp target={challenges.length} />
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "#059669" }} />
            <span className="font-mono text-xs font-bold uppercase" style={{ color: "#059669", letterSpacing: "0.05em" }}>{openCount} open now</span>
          </div>
        </div>

        <div className="text-center px-8 border-r" style={{ borderColor: "#e0ddd7" }}>
          <div className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "#45474a" }}>Total Payout</div>
          <div className="mt-3 flex items-baseline justify-center gap-2">
            <span className="font-display font-bold tabular-nums" style={{ fontSize: "3rem", color: "#111519" }}>$<CountUp target={totalPool} /></span>
            <span className="font-display font-medium text-xl" style={{ color: "#45474a" }}>USDC</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Shield className="w-3.5 h-3.5" style={{ color: "#45474a" }} />
            <span className="font-mono text-xs font-bold uppercase" style={{ color: "#45474a", letterSpacing: "0.05em" }}>Secured in Escrow</span>
          </div>
        </div>

        <div className="text-center px-8">
          <div className="font-mono text-xs font-medium uppercase" style={{ letterSpacing: "0.2em", color: "#45474a" }}>Total Submissions</div>
          <div className="font-display font-bold mt-3 tabular-nums" style={{ fontSize: "3rem", color: "#111519" }}>
            <CountUp target={totalSubs} />
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Users className="w-3.5 h-3.5" style={{ color: "#059669" }} />
            <span className="font-mono text-xs font-bold uppercase" style={{ color: "#059669", letterSpacing: "0.05em" }}>Across all challenges</span>
          </div>
        </div>
      </section>

      {/* ═══ MARKET ANALYTICS & OPERATIONS ═══ */}
      <section id="analytics" className="pt-10 pb-12" style={{ backgroundColor: "#f4f3ef", borderRadius: "20px" }}>
        <div className="px-10">
          <h2 className="font-display font-bold mb-8" style={{ fontSize: "1.75rem", color: "#111519" }}>
            Browse Bounty Challenges
          </h2>

          {/* Controls bar */}
          <div className="flex items-center justify-between mb-8">
            {/* View tabs */}
            <div className="inline-flex overflow-hidden" style={{ backgroundColor: "#f5f4f0", border: "1px solid #e8e5df", borderRadius: "10px" }}>
              {(["table", "grid", "timeline"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { if (v !== "timeline") setView(v as "table" | "grid"); }}
                  className="px-5 py-2.5 text-sm font-sans font-medium transition-colors duration-150"
                  style={{
                    backgroundColor: view === v ? "#ffffff" : "transparent",
                    color: view === v ? "#111519" : "#94a3b8",
                    boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                    borderRadius: "8px",
                    margin: "3px",
                  }}
                >
                  {v === "table" ? "Table View" : v === "grid" ? "Grid View" : "Timeline"}
                </button>
              ))}
            </div>

            {/* Filters + actions */}
            <div className="flex items-center gap-3">
              <button type="button" className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans font-medium" style={{ backgroundColor: "#ffffff", border: "1px solid #e8e5df", borderRadius: "10px", color: "#111519" }}>
                <SlidersHorizontal className="w-4 h-4" style={{ color: "#64748b" }} />
                Category: All
              </button>
              <button type="button" className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans font-medium" style={{ backgroundColor: "#ffffff", border: "1px solid #e8e5df", borderRadius: "10px", color: "#111519" }}>
                <Zap className="w-4 h-4" style={{ color: "#64748b" }} />
                Status: Active
              </button>
              <div className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans font-medium" style={{ backgroundColor: "#ffffff", border: "1px solid #e8e5df", borderRadius: "10px", color: "#111519" }}>
                <SlidersHorizontal className="w-4 h-4" style={{ color: "#64748b" }} />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as ChallengeListSort)}
                  className="bg-transparent outline-none cursor-pointer appearance-none pr-2 text-sm font-sans font-medium"
                  style={{ color: "#111519" }}
                >
                  <option value="newest">Amount: All</option>
                  <option value="reward">Amount: &gt;$5k</option>
                  <option value="deadline">Deadline</option>
                </select>
              </div>
              <button type="button" className="p-2.5 transition-colors hover:bg-white" style={{ color: "#94a3b8", borderRadius: "8px" }}>
                <Download className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => query.refetch()} className="p-2.5 transition-colors hover:bg-white" style={{ color: "#94a3b8", borderRadius: "8px" }}>
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="px-10">
          {query.isLoading ? (
            <div className="bg-white p-16 text-center" style={{ borderRadius: "12px" }}>
              <div className="font-mono text-sm" style={{ color: "#94a3b8" }}>Loading challenges...</div>
            </div>
          ) : query.error ? (
            <div className="bg-white p-16 text-center" style={{ borderRadius: "12px" }}>
              <div className="font-mono text-sm" style={{ color: "#dc2626" }}>Unable to load challenges.</div>
              <button type="button" onClick={() => query.refetch()} className="mt-4 px-6 py-2 text-sm font-sans font-bold" style={{ backgroundColor: "#111519", color: "#ffffff", borderRadius: "8px" }}>
                Retry
              </button>
            </div>
          ) : view === "table" ? (
            <>
              <div className="overflow-hidden" style={{ borderRadius: "12px" }}>
                {/* Header */}
                <div
                  className="grid items-center px-8 py-4"
                  style={{ gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1.2fr 0.8fr", backgroundColor: "#25292e", borderRadius: "12px 12px 0 0" }}
                >
                  {["Bounty Title", "Category", "Prize Pool", "Status", "Time Remaining", "Participants"].map((col) => (
                    <div key={col} className="flex items-center gap-1.5 text-white font-mono font-medium uppercase" style={{ fontSize: "11px", letterSpacing: "0.08em" }}>
                      {col}
                      <ChevronDown className="w-3 h-3 opacity-40" />
                    </div>
                  ))}
                </div>

                {/* Rows */}
                {paged.length === 0 ? (
                  <div className="px-8 py-16 text-center bg-white">
                    <div className="font-mono text-sm" style={{ color: "#94a3b8" }}>No challenges found.</div>
                  </div>
                ) : (
                  paged.map((ch) => {
                    const dom = getDomainStyle(ch.domain);
                    const st = getTableStatus(ch.status, ch.deadline);
                    const dead = ch.status?.toLowerCase() === "cancelled";
                    const cd = ch.deadline ? tableCountdown(ch.deadline) : "--";

                    return (
                      <Link
                        key={ch.id}
                        href={`/challenges/${ch.id}`}
                        className="grid items-center px-8 py-6 no-underline transition-colors duration-150 hover:!bg-[#f8f7f3]"
                        style={{
                          gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1.2fr 0.8fr",
                          backgroundColor: "#ffffff",
                          borderTop: "1px solid #f0eee9",
                        }}
                      >
                        <div>
                          <div className="font-sans font-bold leading-snug" style={{ fontSize: "1.15rem", color: dead ? "#94a3b8" : "#111519" }}>{ch.title}</div>
                          <div className="font-sans text-sm mt-1.5 line-clamp-1" style={{ color: dead ? "#cbd5e1" : "#94a3b8" }}>{ch.description?.slice(0, 80) || "No description."}</div>
                        </div>
                        <div>
                          <span className="inline-block px-3 py-1 font-mono font-medium uppercase" style={{ fontSize: "10px", letterSpacing: "0.05em", backgroundColor: dead ? "#f8fafc" : dom.bg, color: dead ? "#94a3b8" : dom.text, borderRadius: "6px" }}>
                            {dom.label}
                          </span>
                        </div>
                        <div className="font-sans font-bold tabular-nums" style={{ fontSize: "1.5rem", color: dead ? "#cbd5e1" : "#111519" }}>${formatUsdc(ch.reward_amount)}</div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 flex-shrink-0" style={{ backgroundColor: st.dot, borderRadius: "50%" }} />
                          <span className="font-mono font-medium uppercase" style={{ fontSize: "10px", letterSpacing: "0.05em", color: st.text }}>{st.label}</span>
                        </div>
                        <div className="font-mono text-sm tabular-nums" style={{ color: st.timeColor, fontWeight: st.label === "ENDING SOON" ? 700 : 400 }}>{dead ? "--" : cd}</div>
                        <div className="text-right">
                          <span className="font-sans font-bold text-xl tabular-nums" style={{ color: dead ? "#cbd5e1" : "#111519" }}>{ch.submissions_count ?? 0}</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {rows.length > PAGE_SIZE && (
                <div className="flex items-center justify-between mt-6">
                  <span className="font-sans font-medium text-sm" style={{ color: "#64748b" }}>
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length} results
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="p-2 disabled:opacity-30" style={{ borderRadius: "8px" }}>
                      <ChevronLeft className="w-4 h-4" style={{ color: page === 1 ? "#cbd5e1" : "#111519" }} />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let pn: number;
                      if (totalPages <= 5) pn = i + 1;
                      else if (page <= 3) pn = i + 1;
                      else if (page >= totalPages - 2) pn = totalPages - 4 + i;
                      else pn = page - 2 + i;
                      return (
                        <button key={pn} type="button" onClick={() => setPage(pn)} className="w-9 h-9 text-sm font-sans font-bold transition-colors" style={{ backgroundColor: page === pn ? "#111519" : "transparent", color: page === pn ? "#ffffff" : "#64748b", borderRadius: "8px" }}>
                          {pn}
                        </button>
                      );
                    })}
                    {totalPages > 5 && page < totalPages - 2 && (
                      <>
                        <span className="px-1 font-sans font-bold" style={{ color: "#cbd5e1" }}>...</span>
                        <button type="button" onClick={() => setPage(totalPages)} className="w-9 h-9 text-sm font-sans font-bold" style={{ color: "#64748b", borderRadius: "8px" }}>{totalPages}</button>
                      </>
                    )}
                    <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="p-2 disabled:opacity-30" style={{ borderRadius: "8px" }}>
                      <ChevronRight className="w-4 h-4" style={{ color: page === totalPages ? "#cbd5e1" : "#111519" }} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {paged.map((row) => (<ChallengeCard key={row.id} challenge={row} />))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
