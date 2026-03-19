# Evaluation Guide

Expected authoring behavior:

- infer a JSON submission contract
- keep `source_records.json` solver-visible
- keep `reference_output.json` hidden
- infer `exact_artifact_match` instead of a managed runtime family
- build an executable semi-custom exact-match contract

This benchmark should not:

- collapse into `reproducibility` as a managed family
- relabel artifacts as `training_data` or `hidden_labels`
- require Expert Mode
