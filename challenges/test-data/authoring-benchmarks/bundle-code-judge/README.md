# Bundle Code Judge

Typed-only semi-custom benchmark for deterministic bundle or code submissions.

This benchmark covers challenges where:
- solvers submit one packaged `.zip` bundle
- Agora evaluates the bundle against a hidden rubric or judge definition
- the scoring rule is deterministic, but there is no configured execution template yet

Use this benchmark to check that authoring:
- routes the draft to `semi_custom`
- selects the `bundle_or_code_judge` evaluator archetype
- keeps artifact roles generic (`public_inputs`, `hidden_reference`)
- preserves the packaged submission contract as an opaque `.zip` file

This is intentionally not executable yet. The expected outcome is operator review, not immediate publish approval.
