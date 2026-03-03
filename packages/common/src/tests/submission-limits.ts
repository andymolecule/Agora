import assert from "node:assert/strict";
import {
  SUBMISSION_LIMITS,
  getSubmissionLimitViolation,
  resolveSubmissionLimits,
} from "../index.js";

const defaults = resolveSubmissionLimits();
assert.equal(defaults.maxSubmissionsTotal, SUBMISSION_LIMITS.maxPerChallenge);
assert.equal(
  defaults.maxSubmissionsPerSolver,
  SUBMISSION_LIMITS.maxPerSolverPerChallenge,
);

const custom = resolveSubmissionLimits({
  max_submissions_total: 42,
  max_submissions_per_solver: 2,
});
assert.equal(custom.maxSubmissionsTotal, 42);
assert.equal(custom.maxSubmissionsPerSolver, 2);

const totalViolation = getSubmissionLimitViolation({
  totalSubmissions: 43,
  solverSubmissions: 1,
  limits: custom,
});
assert.ok(totalViolation?.includes("challenge reached max submissions"));

const solverViolation = getSubmissionLimitViolation({
  totalSubmissions: 42,
  solverSubmissions: 3,
  limits: custom,
});
assert.ok(solverViolation?.includes("solver reached max submissions"));

const ok = getSubmissionLimitViolation({
  totalSubmissions: 42,
  solverSubmissions: 2,
  limits: custom,
});
assert.equal(ok, null);

console.log("submission limits validation passed");
