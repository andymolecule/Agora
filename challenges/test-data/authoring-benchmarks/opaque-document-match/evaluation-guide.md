# Evaluation Guide

## Intent

This benchmark checks that Agora can keep a deterministic exact-match task in a
generic semi-custom path even when the submission is an opaque file instead of
CSV or JSON.

## What Should Happen

- The draft should route to `semi_custom`.
- The evaluator archetype should be `exact_artifact_match`.
- Agora should keep the role vocabulary generic:
  - `source_packet.pdf` -> `public_inputs`
  - `reference_output.pdf` -> `hidden_reference`
- The submission contract should stay `opaque_file` with PDF metadata.
- The review action should remain `approve_after_review`.
- The dry run should validate because `official_exact_match_v1` now supports
  opaque-file exact-match execution.

## What Should Not Happen

- It should not collapse into the managed `reproducibility` family.
- It should not require Expert Mode.
- It should not relabel the source packet as hidden just because both files are
  PDFs.

## Follow-Up Expectations

Good follow-up questions, if they appear, should stay focused on:

- confirming that the winning rule is exact match
- confirming which PDF remains hidden
- confirming reward, distribution, and deadline

Bad follow-up behavior would include:

- treating the task as a prediction challenge
- assuming a CSV submission
- asking for a custom Docker image when the exact-match path already fits
