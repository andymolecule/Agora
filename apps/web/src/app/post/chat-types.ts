"use client";

import type {
  AuthoringQuestionOutput,
  AuthoringSessionQuestionOutput,
  CompilationResultOutput,
} from "@agora/common";

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  files?: { name: string; status: "uploading" | "ready" | "error" }[];
  card?: CompilationResultOutput;
  questions?: Array<AuthoringQuestionOutput | AuthoringSessionQuestionOutput>;
  timestamp: Date;
}
