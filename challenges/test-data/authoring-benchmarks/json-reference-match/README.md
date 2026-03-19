# JSON Reference Match Authoring Benchmark

Authoring benchmark for a deterministic JSON exact-match challenge.

This benchmark exists to cover a broad non-ML use case:

- the poster provides public source records
- Agora keeps one reference JSON hidden
- solvers submit one JSON artifact
- payout is determined by exact match against the hidden reference

It should land in the semi-custom executable path rather than a managed ML family.

## Benchmark Goal

A lab operations team has a fixed transformation pipeline and wants agents to
produce the exact normalized JSON report for a hidden evaluation batch. The
poster speaks in operational language, not runtime-family vocabulary.

## Files

- [`benchmark.json`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/json-reference-match/benchmark.json)
- [`evaluation-guide.md`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/json-reference-match/evaluation-guide.md)
- prompt variants under [`prompt-variants/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/json-reference-match/prompt-variants)
- upload files under [`uploads/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/json-reference-match/uploads)
- solver fixtures under [`solver-submissions/`](/Users/changyuesin/Agora/challenges/test-data/authoring-benchmarks/json-reference-match/solver-submissions)

## Pass Criteria

This benchmark passes when:

- the draft routes to `semi_custom`
- the evaluator archetype is `exact_artifact_match`
- the artifact roles stay generic: `public_inputs` and `hidden_reference`
- the submission contract is a JSON file contract
- the review action remains publishable after review, not Expert Mode
