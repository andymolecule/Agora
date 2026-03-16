import { AlertCircle, CheckCircle } from "lucide-react";
import type { ChallengePostStatus } from "../../../lib/challenge-post";

export function PostStatusBanner({
  className,
  iconSize,
  status,
  postedChallengeId,
}: {
  className: string;
  iconSize: number;
  status: ChallengePostStatus | null;
  postedChallengeId: string | null;
}) {
  if (!status) return null;

  const isSuccess = status.tone === "success";
  const isWarning = status.tone === "warning";
  const iconColor = isSuccess
    ? "var(--color-success)"
    : isWarning
      ? "var(--color-warning)"
      : "var(--text-tertiary)";

  return (
    <div
      className={`${className} ${isSuccess ? "success" : ""} ${isWarning ? "warning" : ""}`}
    >
      {isSuccess ? (
        <CheckCircle
          size={iconSize}
          style={{
            color: iconColor,
            flexShrink: 0,
            marginTop: 2,
          }}
        />
      ) : (
        <AlertCircle
          size={iconSize}
          style={{
            color: iconColor,
            flexShrink: 0,
            marginTop: 2,
          }}
        />
      )}
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <p>{status.message}</p>
        {isSuccess && postedChallengeId ? (
          <a
            href={`/challenges/${postedChallengeId}`}
            style={{
              color: "var(--color-success)",
              fontWeight: 700,
              textDecoration: "underline",
            }}
          >
            View challenge
          </a>
        ) : null}
      </div>
    </div>
  );
}
