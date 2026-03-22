"use client";

import type { questionPromptTargetFromQuestions } from "./guided-state";

export function questionHelperText(
  target: ReturnType<typeof questionPromptTargetFromQuestions>,
) {
  switch (target) {
    case "winningCondition":
      return "Update the winning condition, then reconfirm the later answers below it.";
    case "uploads":
      return "Review the uploaded files, rename any ambiguous aliases, and make sure the problem statement still matches them.";
    case "problem":
      return "Tighten the problem statement so Agora can map the files and scoring rules safely.";
  }
}
