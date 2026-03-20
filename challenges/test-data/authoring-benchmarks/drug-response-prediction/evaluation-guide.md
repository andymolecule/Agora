# Evaluation Guide

## Core Principle

Score this benchmark on **invariants and behavior**, not exact wording and not
one exact compile blob.

The onboarding flow is doing its job if it can tolerate realistic ambiguity and
still converge on the correct managed contract.

## What Counts As A Pass

- The draft stays in managed mode.
- The compile result lands on `prediction` / `tabular_regression` / `r2`.
- `drug_response_train.csv` is treated as public training data.
- `drug_response_holdout.csv` is treated as public evaluation features.
- `heldout_response_labels.csv` is treated as private hidden labels.
- The final submission contract requires `id,prediction`.
- The system asks for missing reward/timeline information instead of guessing silently.

## What Counts As A Failure

- The draft routes to Expert Mode.
- The compiler picks docking, reproducibility, ranking, or classification.
- Hidden labels are exposed as public.
- The system treats "lowest AUC wins" as the payout rule instead of asking for a
  metric-based winning condition.
- The system never asks who the hidden labels belong to when the prompt is ambiguous.

## Ambiguity This Benchmark Intentionally Preserves

- The poster mixes "drug response", "viability", "sensitivity", and "AUC".
- The poster talks about the science first and the file contract second.
- The poster does not begin with exact submission-schema language.

## Manual QA Notes

When running the benchmark, record:

- which prompt variant you used
- whether the first follow-up question felt like the right next question
- whether the compile result was `ready`
- whether any clarification asked a domain-relevant question or merely echoed the form schema
