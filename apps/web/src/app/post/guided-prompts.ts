"use client";

import type {
  GuidedFieldKey,
  GuidedPromptConfig,
  InputKind,
} from "./guided-state";

type GuidedPromptDefinition = GuidedPromptConfig & {
  placeholder?: string;
  helper?: string;
  options?: { label: string; value: string }[];
};

export const GUIDED_PROMPT_ORDER = [
  "problem",
  "uploads",
  "winningCondition",
  "rewardTotal",
  "distribution",
  "deadline",
  "solverInstructions",
] as const satisfies readonly Exclude<GuidedFieldKey, "title">[];

export const GUIDED_DISTRIBUTION_OPTIONS = [
  { label: "Winner takes all", value: "winner_take_all" },
  { label: "Top 3 split", value: "top_3" },
  { label: "Proportional", value: "proportional" },
] as const satisfies readonly { label: string; value: string }[];

export const INPUT_KIND_LABELS: Record<InputKind, string> = {
  textarea: "Long answer",
  file: "File upload",
  currency: "Currency",
  select: "Select",
  date: "Date",
  text: "Text",
};

export const GUIDED_PROMPTS: Record<
  (typeof GUIDED_PROMPT_ORDER)[number],
  GuidedPromptDefinition
> = {
  problem: {
    id: "problem",
    prompt: "What scientific problem do you want solved?",
    inputKind: "textarea",
    placeholder:
      "Explain the task in plain language. What should solvers predict, reproduce, rank, or optimize?",
    helper:
      "Start with the scientific question. We will ask for files, payout, and deadline next.",
  },
  uploads: {
    id: "uploads",
    prompt: "Upload the files Agora should use to define and score this bounty.",
    inputKind: "file",
    helper:
      "Use descriptive file aliases so Agora can infer which data should stay public and which should stay hidden for evaluation.",
  },
  winningCondition: {
    id: "winningCondition",
    prompt: "What should count as a winning result?",
    inputKind: "textarea",
    placeholder:
      "Example: Highest Spearman correlation on the hidden labels wins.",
  },
  rewardTotal: {
    id: "rewardTotal",
    prompt: "How much USDC should this bounty pay?",
    inputKind: "currency",
    placeholder: "500",
  },
  distribution: {
    id: "distribution",
    prompt: "How should the reward split across winners?",
    inputKind: "select",
    options: [...GUIDED_DISTRIBUTION_OPTIONS],
  },
  deadline: {
    id: "deadline",
    prompt: "When should submissions close?",
    inputKind: "date",
  },
  solverInstructions: {
    id: "solverInstructions",
    prompt: "Anything solvers should know before they start?",
    inputKind: "textarea",
    optional: true,
    canSkip: true,
    placeholder:
      "Optional: scientific caveats, accepted formats, allowed assumptions, or forbidden shortcuts.",
  },
};

