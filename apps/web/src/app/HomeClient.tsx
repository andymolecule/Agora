"use client";

import { CHALLENGE_STATUS } from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronDown,
  Search as SearchIcon,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChallengeCard } from "../components/ChallengeCard";
import {
  type ChallengeFilterState,
  FilterPanel,
  FilterToggle,
  SearchBar,
} from "../components/ChallengeFilters";
import { listChallenges } from "../lib/api";
import { type ChallengeListSort, sortChallenges } from "../lib/challenge-list";
import { formatUsdc } from "../lib/format";

function CountUp({ target, prefix = "", duration = 800 }: { target: number; prefix?: string; duration?: number }) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current || target === 0) {
      setValue(target);
      return;
    }
    hasAnimated.current = true;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);

  return <span ref={ref}>{prefix}{formatUsdc(value)}</span>;
}

export function HomeClient() {
  /* ── Filter + search state ── */
  const [filters, setFilters] = useState<ChallengeFilterState>({
    domain: "",
    status: "",
    minReward: "",
    search: "",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<ChallengeListSort>("newest");

  const hasActiveFilters = !!(
    filters.domain ||
    filters.status ||
    filters.minReward
  );

  function updateFilters(next: Partial<ChallengeFilterState>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

  /* ── Data ── */
  const query = useQuery({
    queryKey: ["challenges", filters.domain, filters.status, filters.minReward],
    queryFn: () =>
      listChallenges({
        domain: filters.domain || undefined,
        status: filters.status || undefined,
        minReward: filters.minReward ? Number(filters.minReward) : undefined,
      }),
  });

  const challenges = query.data ?? [];

  /* Derived stats */
  const openChallenges = challenges.filter(
    (c) => c.status?.toLowerCase() === CHALLENGE_STATUS.open,
  );
  const totalPool = challenges.reduce(
    (s, c) => s + Number(c.reward_amount || 0),
    0,
  );
  const totalSubs = challenges.reduce(
    (s, c) => s + (c.submissions_count ?? 0),
    0,
  );

  /* Filtered + sorted rows */
  const rows = useMemo(() => {
    const base = [...challenges].filter((row) => {
      if (!filters.search) return true;
      const q = filters.search.toLowerCase();
      return (
        row.title.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q)
      );
    });

    return sortChallenges(base, sort);
  }, [challenges, filters.search, sort]);

  return (
    <div className="space-y-6">
      {/* ═══════ HERO ═══════ */}
      <section className="py-10 text-center">
        <h1 className="text-[3.5rem] sm:text-[4.5rem] leading-[0.9] font-display font-bold text-warm-900 tracking-[-0.06em]">
          Science Bounty
        </h1>
        <p className="text-sm text-warm-900/50 font-mono font-medium mt-3 mb-6 uppercase tracking-wider">
          Deterministic scoring · On-chain USDC settlement
        </p>

        {/* Post Bounty — inverted CTA */}
        <div className="flex justify-center mb-6">
          <Link
            href="/post"
            className="btn-primary inline-flex items-center justify-center gap-2 px-8 py-3 font-semibold text-sm uppercase font-mono tracking-wider no-underline"
          >
            <Sparkles className="w-4 h-4" />
            Post Bounty
          </Link>
        </div>

        {/* Stats ticker — neo-brutalist KPI strip */}
        <div className="kpi-strip max-w-2xl mx-auto">
          {[
            { label: "TVL", value: totalPool, prefix: "$" },
            { label: "Open", value: openChallenges.length },
            { label: "Submissions", value: totalSubs },
            { label: "Challenges", value: challenges.length },
          ].map((stat) => (
            <div key={stat.label} className="kpi-cell">
              <div className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-warm-500">
                {stat.label}
              </div>
              <div className="text-3xl sm:text-4xl font-display font-bold text-warm-900 tabular-nums mt-2">
                <CountUp target={stat.value} prefix={stat.prefix} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ SEARCH + FILTER ROW ═══════ */}
      <div className="flex items-stretch border border-warm-900 rounded-[2px] overflow-hidden">
        <SearchBar
          value={filters.search}
          onChange={(v) => updateFilters({ search: v })}
        />
        <FilterToggle
          isOpen={filtersOpen}
          onToggle={() => setFiltersOpen(!filtersOpen)}
          hasActiveFilters={hasActiveFilters}
        />
        <div className="flex items-center border-l border-warm-900 hover:bg-warm-900 hover:text-white transition-colors duration-150 group/sort">
          <ArrowUpDown className="w-3.5 h-3.5 text-warm-900/50 group-hover/sort:text-white/60 ml-3" />
          <div className="relative">
            <select
              className="text-[10px] font-bold font-mono uppercase tracking-wider pl-3 pr-7 py-3 bg-transparent text-inherit outline-none cursor-pointer appearance-none border-none"
              value={sort}
              onChange={(e) => setSort(e.target.value as ChallengeListSort)}
            >
              <option value="newest">Newest</option>
              <option value="deadline">Deadline</option>
              <option value="reward">Reward</option>
            </select>
            <ChevronDown className="w-3 h-3 opacity-40 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* ═══════ FILTER PANEL (collapsible) ═══════ */}
      <FilterPanel
        isOpen={filtersOpen}
        state={filters}
        onUpdate={updateFilters}
      />

      {/* ═══════ LOADING / ERROR / EMPTY ═══════ */}
      {query.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton-card">
              <div className="flex items-start justify-between">
                <div className="skeleton skeleton-icon" />
                <div className="skeleton skeleton-badge" />
              </div>
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-desc" />
              <div className="skeleton skeleton-desc-short" />
              <div className="skeleton skeleton-footer" />
            </div>
          ))}
        </div>
      ) : null}

      {query.error ? (
        <div className="border border-warm-900 p-8 text-center">
          <div className="font-mono font-bold text-sm uppercase tracking-wider text-warm-900/60">
            Unable to connect to API.
          </div>
          {query.error instanceof Error ? (
            <div className="mt-3 text-xs font-mono text-warm-900/50 normal-case tracking-normal">
              {query.error.message}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-4 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider border border-warm-900 bg-white text-warm-900 hover:bg-warm-900 hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!query.isLoading && !query.error && rows.length === 0 ? (
        <div className="border border-warm-900 p-8 max-w-lg mx-auto bg-white">
          <div className="font-mono text-sm space-y-1 text-warm-900/70">
            <div className="flex items-center gap-2 mb-3">
              <SearchIcon className="w-4 h-4" />
              <span className="text-[10px] uppercase tracking-wider font-bold">
                agora
              </span>
            </div>
            <p>$ agora query --open</p>
            <p>&gt; No challenges found.</p>
            <p>&gt; Try adjusting filters or post the first bounty.</p>
            <p className="inline-block animate-[blink_1s_step-end_infinite]">
              _
            </p>
          </div>
        </div>
      ) : null}

      {/* ═══════ CHALLENGE GRID ═══════ */}
      {!query.isLoading && rows.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-bold text-warm-900/60 tabular-nums">
              {rows.length} {rows.length === 1 ? "challenge" : "challenges"}
            </span>
          </div>
          <div className="bg-plus-pattern border border-warm-900 p-4 sm:p-8 rounded-[2px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {rows.map((row) => (
                <ChallengeCard key={row.id} challenge={row} />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
