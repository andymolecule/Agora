import { CHALLENGE_STATUS, type ChallengeStatus } from "@agora/common";

export type StatusStyle = { bg: string; text: string; borderColor: string };

export const DEFAULT_STATUS_STYLE: StatusStyle = {
  bg: "var(--color-success-bg)",
  text: "var(--color-success)",
  borderColor: "var(--color-success-border)",
};

export const STATUS_STYLES: Record<ChallengeStatus | "judging", StatusStyle> = {
  [CHALLENGE_STATUS.open]: DEFAULT_STATUS_STYLE,
  [CHALLENGE_STATUS.scoring]: {
    bg: "var(--color-warning-bg)",
    text: "var(--color-warning)",
    borderColor: "var(--color-warning-border)",
  },
  judging: {
    bg: "var(--color-warning-bg)",
    text: "var(--color-warning)",
    borderColor: "var(--color-warning-border)",
  },
  [CHALLENGE_STATUS.finalized]: {
    bg: "var(--color-cobalt-100)",
    text: "var(--color-cobalt-500)",
    borderColor: "var(--color-cobalt-200)",
  },
  [CHALLENGE_STATUS.disputed]: {
    bg: "var(--color-error-bg)",
    text: "var(--color-error)",
    borderColor: "var(--color-error-border)",
  },
  [CHALLENGE_STATUS.cancelled]: {
    bg: "var(--surface-inset)",
    text: "var(--text-tertiary)",
    borderColor: "var(--border-default)",
  },
};

export function getStatusStyle(status: string | undefined): StatusStyle {
  const normalized = (status ?? CHALLENGE_STATUS.open).toLowerCase();
  return (
    STATUS_STYLES[normalized as ChallengeStatus | "judging"] ??
    DEFAULT_STATUS_STYLE
  );
}
