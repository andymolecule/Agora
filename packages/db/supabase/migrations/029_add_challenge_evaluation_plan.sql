alter table challenges
  add column if not exists evaluation_plan_json jsonb default null;

update challenges
set evaluation_plan_json = jsonb_strip_nulls(
  jsonb_build_object(
    'runtime_family', coalesce(evaluation_json->>'runtime_family', runtime_family),
    'metric', evaluation_json->>'metric',
    'scorer_image', evaluation_json->>'scorer_image',
    'evaluation_bundle', evaluation_json->>'evaluation_bundle',
    'evaluator_contract', evaluation_json->'evaluator_contract',
    'submission_contract', submission_contract_json,
    'env', scoring_env_json,
    'mount',
      case
        when coalesce(evaluation_json->>'runtime_family', runtime_family) in (
          'reproducibility',
          'tabular_regression',
          'tabular_classification',
          'ranking',
          'docking'
        )
          then jsonb_build_object(
            'evaluation_bundle_name', 'ground_truth.csv',
            'submission_file_name', 'submission.csv'
          )
        else null
      end
  )
)
where evaluation_plan_json is null;
