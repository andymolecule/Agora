export interface ChallengeRow {
  id: string;
  contract_address: string;
  scoring_container: string;
  scoring_preset_id?: string | null;
  dataset_test_cid: string | null;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export interface SubmissionRow {
  id: string;
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_cid: string | null;
  proof_bundle_cid?: string | null;
}

export interface ScoreJobRow {
  id: string;
  submission_id: string;
  challenge_id: string;
  attempts: number;
  max_attempts: number;
  score_tx_hash: string | null;
}

export type WorkerLogLevel = "info" | "warn" | "error";
export type WorkerLogFn = (
  level: WorkerLogLevel,
  message: string,
  meta?: Record<string, unknown>,
) => void;
