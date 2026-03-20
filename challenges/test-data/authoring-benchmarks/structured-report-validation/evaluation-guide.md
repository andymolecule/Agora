# Evaluation Guide

Expected authoring behavior:

- infer a JSON submission contract
- keep `report_schema.json` solver-visible
- keep `validation_rubric.json` hidden
- infer `structured_record_score`
- route to definition-backed review with `approve_after_review`
- validate a dry-run with the official structured record execution template

This benchmark should not:

- collapse into a managed runtime family
- relabel artifacts as `training_data` or `hidden_labels`
- infer an executable exact-match path
