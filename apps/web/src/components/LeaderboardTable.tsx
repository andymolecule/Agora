import { Trophy } from "lucide-react";
import { formatDateTime, formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";
import { HatchedDivider } from "./HatchedDivider";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 border border-warm-900 bg-warm-100">
        <Trophy className="w-8 h-8 mx-auto mb-3 text-warm-900/40" strokeWidth={1.5} />
        <p className="text-sm text-warm-900/60 font-mono font-bold uppercase tracking-wider">No submissions yet.</p>
      </div>
    );
  }

  const rankColors = [
    { bg: "#EAB308", text: "#fff" }, // gold
    { bg: "#94A3B8", text: "#fff" }, // silver
    { bg: "#EA580C", text: "#fff" }, // bronze
  ];

  return (
    <div className="border border-warm-900">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-warm-100">
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-warm-900 border-r border-b border-warm-900">
              #
            </th>
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-warm-900 border-r border-b border-warm-900">
              Solver
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-warm-900 border-r border-b border-warm-900">
              Score
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-warm-900 border-b border-warm-900">
              Submitted
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((row, i) => (
            <tr
              key={`${row.solver_address}-${row.on_chain_sub_id}`}
              className="border-b last:border-b-0 border-warm-900 hover:bg-warm-900/5 transition-colors"
            >
              <td className="py-3 px-4 border-r border-warm-900">
                {i < 3 ? (
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold font-mono border border-warm-900"
                    style={{
                      backgroundColor: rankColors[i]?.bg,
                      color: rankColors[i]?.text,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold text-warm-900/60 w-6 h-6 inline-flex items-center justify-center border border-transparent">{i + 1}</span>
                )}
              </td>
              <td className="py-3 px-4 border-r border-warm-900 font-medium">
                <span className="font-mono text-xs text-warm-900 tabular-nums font-bold">
                  {shortAddress(row.solver_address)}
                </span>
              </td>
              <td className="py-3 px-4 text-right border-r border-warm-900">
                {row.score !== null ? (
                  <span className="font-mono text-xs font-bold text-warm-900 tabular-nums">
                    {formatWadToScore(row.score)}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-warm-900/40">Pending</span>
                )}
              </td>
              <td className="py-3 px-4 text-right font-mono text-xs font-bold text-warm-900/60 tabular-nums">
                {formatDateTime(row.submitted_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
