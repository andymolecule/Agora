# Evaluation Guide

Expected compile outcome:
- state: `needs_review`
- runtime family: `semi_custom`
- evaluator archetype: `bundle_or_code_judge`
- submission contract: opaque `.zip` bundle
- recommended action: not `approve_after_review`

Why it stays typed-only:
- the draft is deterministic enough to type
- the bundle packaging is clear enough to infer
- the repo does not yet have a constrained execution template for arbitrary bundle judges

What the guided flow should clarify:
- what files must be present in the submitted bundle
- how the hidden rubric or judge determines a score
- which artifacts are visible to solvers and which stay hidden
- reward, distribution, and submission deadline details if omitted

What counts as a pass:
- no managed runtime family is chosen
- no ML-specific artifact roles leak into the draft
- the bundle submission contract resolves to `.zip` / `application/zip`
- the draft stays review-gated instead of pretending it is executable
