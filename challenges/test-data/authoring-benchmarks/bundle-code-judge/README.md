# Bundle Code Judge

Benchmark for deterministic bundle or code submissions that should fall out of the assisted Gems path and into the explicit custom scorer workflow.

This benchmark covers challenges where:
- solvers submit one packaged `.zip` bundle
- Agora evaluates the bundle against a hidden rubric or judge definition
- the scoring rule is deterministic, but there is no configured execution template yet

Use this benchmark to check that authoring:
- rejects the draft from the managed Gems path
- keeps artifact roles generic (`public_inputs`, `hidden_reference`)
- preserves the packaged submission contract as an opaque `.zip` file in the custom workflow contract
- points the poster toward the explicit custom scorer workflow instead of pretending the challenge is publishable
