import { Trophy } from "lucide-react";
import { formatDateTime, formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-[#f6f3ed] rounded-xl py-10 text-center">
        <Trophy className="w-8 h-8 mx-auto mb-3 text-[#8c9096]" strokeWidth={1.5} />
        <p className="text-sm text-[#8c9096] font-mono uppercase tracking-widest">No submissions yet.</p>
      </div>
    );
  }

  const rankColors = [
    { bg: "#111519", text: "#fff" },
    { bg: "#45474a", text: "#fff" },
    { bg: "#8c9096", text: "#fff" },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-[#e5e2dc]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#ebe8e2]">
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[#8c9096] border-b border-[#e5e2dc]">
              #
            </th>
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[#8c9096] border-b border-[#e5e2dc]">
              Solver
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[#8c9096] border-b border-[#e5e2dc]">
              Score
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[#8c9096] border-b border-[#e5e2dc]">
              Submitted
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((row, i) => (
            <tr
              key={`${row.solver_address}-${row.on_chain_sub_id}`}
              className="border-b last:border-b-0 border-[#e5e2dc] hover:bg-[#f6f3ed]/50 transition-colors"
            >
              <td className="py-3.5 px-4">
                {i < 3 ? (
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold font-mono rounded-md"
                    style={{
                      backgroundColor: rankColors[i]?.bg,
                      color: rankColors[i]?.text,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold text-[#8c9096] w-6 h-6 inline-flex items-center justify-center">{i + 1}</span>
                )}
              </td>
              <td className="py-3.5 px-4 font-medium">
                <span className="font-mono text-xs text-[#111519] tabular-nums font-bold">
                  {shortAddress(row.solver_address)}
                </span>
              </td>
              <td className="py-3.5 px-4 text-right">
                {row.score !== null ? (
                  <span className="font-mono text-xs font-bold text-[#111519] tabular-nums">
                    {formatWadToScore(row.score)}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#8c9096]">Pending</span>
                )}
              </td>
              <td className="py-3.5 px-4 text-right font-mono text-xs text-[#8c9096] tabular-nums">
                {formatDateTime(row.submitted_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
