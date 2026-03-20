import csv
import json
import math
import os
import zipfile
from pathlib import Path

RUNTIME_CONFIG_FILE_NAME = "agora-runtime.json"

NUMERIC_METRICS = {"r2", "rmse", "mae", "pearson", "spearman"}
CLASSIFICATION_METRICS = {"accuracy", "f1"}


def _output_path(output_dir: Path) -> Path:
    return output_dir / "score.json"


def deterministic_json_write(output_dir: Path, payload: dict) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _output_path(output_dir).write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


def fail_runtime(output_dir: Path, message: str) -> None:
    deterministic_json_write(
        output_dir, {"ok": False, "score": 0.0, "error": message, "details": {}}
    )
    raise SystemExit(1)


def reject_submission(
    output_dir: Path, message: str, details: dict | None = None
) -> None:
    deterministic_json_write(
        output_dir,
        {
            "ok": False,
            "score": 0.0,
            "error": message,
            "details": details or {},
        },
    )
    raise SystemExit(0)


def load_runtime_config(input_dir: Path, output_dir: Path) -> dict:
    runtime_config_path = input_dir / RUNTIME_CONFIG_FILE_NAME
    if not runtime_config_path.exists():
        fail_runtime(output_dir, "Missing required file: /input/agora-runtime.json")

    try:
        runtime_config = json.loads(runtime_config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail_runtime(
            output_dir,
            f"Invalid runtime config JSON at /input/agora-runtime.json: {error.msg}",
        )

    if runtime_config.get("version") != "v1":
        fail_runtime(output_dir, "Unsupported runtime config version. Expected version=v1.")

    mount = runtime_config.get("mount")
    if not isinstance(mount, dict):
        fail_runtime(output_dir, "Runtime config mount must be an object.")

    submission_file_name = mount.get("submission_file_name")
    evaluation_bundle_name = mount.get("evaluation_bundle_name")
    if not isinstance(submission_file_name, str) or not submission_file_name:
        fail_runtime(
            output_dir, "Runtime config submission_file_name must be a non-empty string."
        )

    return {
        "raw": runtime_config,
        "metric": str(runtime_config.get("metric") or "custom"),
        "submission_path": input_dir / submission_file_name,
        "evaluation_path": input_dir / evaluation_bundle_name
        if isinstance(evaluation_bundle_name, str) and evaluation_bundle_name
        else None,
        "submission_contract": runtime_config.get("submission_contract"),
        "evaluation_contract": runtime_config.get("evaluation_contract"),
        "policies": runtime_config.get("policies", {}),
    }


def read_csv_rows(
    path: Path, label: str, output_dir: Path, runtime_error: bool
) -> list[dict[str, str]]:
    if not path.exists():
        message = f"Missing required file: {path}"
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))
    except Exception as error:
        message = f"{label} is not valid CSV data: {error}"
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)
    raise AssertionError("unreachable")


def read_json_document(
    path: Path, label: str, output_dir: Path, runtime_error: bool
):
    if not path.exists():
        message = f"Missing required file: {path}"
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        message = f"{label} is not valid JSON: {error.msg}"
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)
    raise AssertionError("unreachable")


def read_binary_document(
    path: Path, label: str, output_dir: Path, runtime_error: bool
) -> bytes:
    if not path.exists():
        message = f"Missing required file: {path}"
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)

    try:
        return path.read_bytes()
    except Exception as error:
        message = f"{label} could not be read: {error}"
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)
    raise AssertionError("unreachable")


def normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [entry.strip() for entry in value if isinstance(entry, str) and entry.strip()]


def has_present_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return len(value.strip()) > 0
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def parse_allowed_string_values(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, list[str]] = {}
    for field, options in value.items():
        if not isinstance(field, str):
            continue
        normalized_options = normalize_string_list(options)
        if normalized_options:
            normalized[field] = normalized_options
    return normalized


def parse_structured_record_rubric(document: object, output_dir: Path) -> dict[str, object]:
    if not isinstance(document, dict):
        fail_runtime(output_dir, "Structured record rubric must be a JSON object.")

    required_fields = normalize_string_list(
        document.get("required_fields") or document.get("required_sections")
    )
    non_empty_array_fields = normalize_string_list(
        document.get("non_empty_array_fields")
    )
    allowed_string_values = parse_allowed_string_values(
        document.get("allowed_string_values")
    )

    checks_total = (
        len(required_fields)
        + len(non_empty_array_fields)
        + len(allowed_string_values)
    )
    if checks_total == 0:
        fail_runtime(
            output_dir,
            "Structured record rubric must declare at least one deterministic validation rule.",
        )

    return {
        "required_fields": required_fields,
        "non_empty_array_fields": non_empty_array_fields,
        "allowed_string_values": allowed_string_values,
    }


def parse_bundle_manifest_rubric(document: object, output_dir: Path) -> dict[str, object]:
    if not isinstance(document, dict):
        fail_runtime(output_dir, "Bundle manifest rubric must be a JSON object.")

    required_paths = normalize_string_list(document.get("required_paths"))
    forbidden_paths = normalize_string_list(document.get("forbidden_paths"))
    required_extensions = normalize_string_list(document.get("required_extensions"))

    max_total_uncompressed_bytes_value = document.get("max_total_uncompressed_bytes")
    max_file_count_value = document.get("max_file_count")
    max_total_uncompressed_bytes = (
        int(max_total_uncompressed_bytes_value)
        if isinstance(max_total_uncompressed_bytes_value, (int, float))
        else None
    )
    max_file_count = (
        int(max_file_count_value)
        if isinstance(max_file_count_value, (int, float))
        else None
    )

    checks_total = (
        len(required_paths)
        + len(forbidden_paths)
        + len(required_extensions)
        + (1 if max_total_uncompressed_bytes is not None else 0)
        + (1 if max_file_count is not None else 0)
    )
    if checks_total == 0:
        fail_runtime(
            output_dir,
            "Bundle manifest rubric must declare at least one deterministic validation rule.",
        )

    return {
        "required_paths": required_paths,
        "forbidden_paths": forbidden_paths,
        "required_extensions": required_extensions,
        "max_total_uncompressed_bytes": max_total_uncompressed_bytes,
        "max_file_count": max_file_count,
    }


def list_zip_entries(path: Path, output_dir: Path) -> tuple[list[str], int]:
    try:
        with zipfile.ZipFile(path, "r") as archive:
            file_infos = [info for info in archive.infolist() if not info.is_dir()]
            names = [info.filename for info in file_infos]
            duplicate_names = sorted(
                {name for name in names if names.count(name) > 1}
            )
            if duplicate_names:
                reject_submission(
                    output_dir,
                    "Submission bundle must not contain duplicate file paths.",
                    {"duplicate_paths": duplicate_names},
                )
            total_uncompressed_bytes = sum(info.file_size for info in file_infos)
            return names, total_uncompressed_bytes
    except zipfile.BadZipFile:
        reject_submission(
            output_dir,
            "Submission must be a valid .zip bundle.",
            {"comparison_kind": "bundle_manifest"},
        )
    except Exception as error:
        reject_submission(
            output_dir,
            f"Submission bundle could not be inspected: {error}",
            {"comparison_kind": "bundle_manifest"},
        )
    raise AssertionError("unreachable")


def _require_csv_contract(contract: object, label: str, output_dir: Path) -> dict:
    if not isinstance(contract, dict) or contract.get("kind") != "csv_table":
        fail_runtime(output_dir, f"Runtime contract {label} must be kind=csv_table.")

    columns = contract.get("columns")
    if not isinstance(columns, dict):
        fail_runtime(output_dir, f"Runtime contract {label} is missing columns.")

    required = columns.get("required")
    id_col = columns.get("id")
    value_col = columns.get("value")
    if (
        not isinstance(required, list)
        or not required
        or not all(isinstance(col, str) and col for col in required)
    ):
        fail_runtime(output_dir, f"Runtime contract {label} must declare required columns.")
    if not isinstance(id_col, str) or not id_col:
        fail_runtime(output_dir, f"Runtime contract {label} must declare columns.id.")
    if not isinstance(value_col, str) or not value_col:
        fail_runtime(output_dir, f"Runtime contract {label} must declare columns.value.")
    allow_extra = columns.get("allow_extra", True)
    if not isinstance(allow_extra, bool):
        fail_runtime(output_dir, f"Runtime contract {label} must use boolean allow_extra.")

    return {
        "required": required,
        "id": id_col,
        "value": value_col,
        "allow_extra": allow_extra,
    }


def _validate_header(
    rows: list[dict[str, str]],
    contract: dict,
    file_label: str,
    output_dir: Path,
    runtime_error: bool,
) -> None:
    if not rows:
        message = f"{file_label} is empty."
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(output_dir, message)

    present_columns = list(rows[0].keys())
    present_set = set(present_columns)
    missing = [col for col in contract["required"] if col not in present_set]
    if missing:
        message = f"{file_label} must contain required columns: {','.join(contract['required'])}."
        if runtime_error:
            fail_runtime(output_dir, message)
        reject_submission(
            output_dir,
            message,
            {
                "missing_columns": missing,
                "uploaded_columns": present_columns,
            },
        )

    if not contract["allow_extra"]:
        extras = [col for col in present_columns if col not in contract["required"]]
        if extras:
            message = f"{file_label} contains unexpected columns: {','.join(extras)}."
            if runtime_error:
                fail_runtime(output_dir, message)
            reject_submission(
                output_dir,
                message,
                {
                    "unexpected_columns": extras,
                    "uploaded_columns": present_columns,
                },
            )


def _build_truth_map(
    truth_rows: list[dict[str, str]],
    contract: dict,
    numeric_values: bool,
    output_dir: Path,
) -> tuple[list[str], dict[str, float | str]]:
    truth_ids: list[str] = []
    truth_map: dict[str, float | str] = {}
    id_col = contract["id"]
    value_col = contract["value"]

    for row in truth_rows:
        row_id = row.get(id_col, "")
        if not row_id:
            fail_runtime(output_dir, "ground_truth.csv contains an empty evaluation id.")
        if row_id in truth_map:
            fail_runtime(output_dir, "ground_truth.csv contains duplicate evaluation ids.")

        raw_value = row.get(value_col, "")
        if raw_value == "":
          fail_runtime(output_dir, "ground_truth.csv contains an empty target value.")

        if numeric_values:
            try:
                truth_value: float | str = float(raw_value)
            except ValueError:
                fail_runtime(output_dir, "ground_truth.csv contains a non-numeric target value.")
        else:
            truth_value = str(raw_value)

        truth_ids.append(row_id)
        truth_map[row_id] = truth_value

    return truth_ids, truth_map


def _summarize_submission(
    sub_rows: list[dict[str, str]],
    submission_contract: dict,
    truth_map: dict[str, float | str],
    policies: dict,
    numeric_values: bool,
    output_dir: Path,
) -> tuple[dict[str, float | str], dict]:
    id_col = submission_contract["id"]
    value_col = submission_contract["value"]

    valid_predictions: dict[str, float | str] = {}
    seen_ids: set[str] = set()
    duplicate_ids: list[str] = []
    invalid_value_ids: list[str] = []
    unexpected_ids: list[str] = []

    for row in sub_rows:
        row_id = row.get(id_col, "")
        if not row_id:
            invalid_value_ids.append("")
            continue
        if row_id in seen_ids:
            duplicate_ids.append(row_id)
            if policies["duplicate_id_policy"] == "reject":
                continue
            if row_id in valid_predictions:
                continue
        seen_ids.add(row_id)

        if row_id not in truth_map:
            unexpected_ids.append(row_id)
            continue

        raw_value = row.get(value_col, "")
        if raw_value == "":
            invalid_value_ids.append(row_id)
            continue

        if numeric_values:
            try:
                prediction_value: float | str = float(raw_value)
            except ValueError:
                invalid_value_ids.append(row_id)
                continue
        else:
            prediction_value = str(raw_value)

        if row_id not in valid_predictions:
            valid_predictions[row_id] = prediction_value

    missing_truth_ids = [row_id for row_id in truth_map if row_id not in valid_predictions]

    details = {
        "submitted_rows": len(sub_rows),
        "expected_rows": len(truth_map),
        "matched_unique_ids": len(valid_predictions),
        "missing_ids": len(missing_truth_ids),
        "unexpected_ids": len(unexpected_ids),
        "duplicate_ids": len(duplicate_ids),
        "invalid_value_ids": len(invalid_value_ids),
    }

    if duplicate_ids and policies["duplicate_id_policy"] == "reject":
        reject_submission(output_dir, "Submission must not contain duplicate prediction ids.", details)

    if invalid_value_ids and policies["invalid_value_policy"] == "reject":
        invalid_message = (
            "Submission contains non-numeric prediction values. Next step: upload a CSV with numeric predictions only."
            if numeric_values
            else "Submission contains empty or invalid label predictions. Next step: upload a CSV with one non-empty prediction for every evaluation id."
        )
        reject_submission(output_dir, invalid_message, details)

    coverage_policy = policies["coverage_policy"]
    if coverage_policy == "penalize":
        fail_runtime(
            output_dir,
            "coverage_policy=penalize is not supported by generated tabular scorers. Next step: use reject or ignore.",
        )
    if coverage_policy == "reject" and (missing_truth_ids or unexpected_ids):
        reject_submission(
            output_dir,
            "Submission must include exactly one prediction row for every evaluation id.",
            details,
        )

    if not valid_predictions:
        reject_submission(
            output_dir,
            "No valid prediction rows matched the evaluation bundle.",
            details,
        )

    return valid_predictions, details


def rankdata(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(indexed):
        j = i
        while j < len(indexed) and indexed[j][1] == indexed[i][1]:
            j += 1
        avg_rank = (i + j + 1) / 2
        for k in range(i, j):
            ranks[indexed[k][0]] = avg_rank
        i = j
    return ranks


def normalize_score(metric: str, value: float, output_dir: Path) -> float:
    if metric == "r2":
        return max(value, 0.0)
    if metric in ("rmse", "mae"):
        return 1.0 / (1.0 + value)
    if metric in ("pearson", "spearman"):
        return max(0.0, min(1.0, (value + 1.0) / 2.0))
    if metric in CLASSIFICATION_METRICS:
        return max(0.0, min(1.0, value))
    fail_runtime(output_dir, f"Unsupported metric {metric}.")


def compute_macro_f1(y_true: list[str], y_pred: list[str]) -> float:
    labels = sorted(set(y_true) | set(y_pred))
    if not labels:
        return 0.0

    f1_scores: list[float] = []
    for label in labels:
        tp = sum(
            1
            for truth, pred in zip(y_true, y_pred)
            if truth == label and pred == label
        )
        fp = sum(
            1
            for truth, pred in zip(y_true, y_pred)
            if truth != label and pred == label
        )
        fn = sum(
            1
            for truth, pred in zip(y_true, y_pred)
            if truth == label and pred != label
        )
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        if precision + recall == 0:
            f1_scores.append(0.0)
        else:
            f1_scores.append((2 * precision * recall) / (precision + recall))

    return sum(f1_scores) / len(f1_scores)


def run_exact_match_csv(input_dir: Path, output_dir: Path) -> None:
    runtime = load_runtime_config(input_dir, output_dir)
    evaluation_path = runtime["evaluation_path"]
    submission_path = runtime["submission_path"]
    if evaluation_path is None:
        fail_runtime(output_dir, "Runtime config evaluation bundle is required.")
    tolerance = float(os.getenv("AGORA_TOLERANCE", "0.001"))
    truth = read_csv_rows(evaluation_path, "Evaluation bundle", output_dir, True)
    submission = read_csv_rows(submission_path, "Submission", output_dir, False)

    if len(truth) == 0:
        deterministic_json_write(
            output_dir,
            {
                "ok": True,
                "details": {
                    "comparison_kind": "csv_table",
                    "comparable_rows": 0,
                    "mismatched_row_penalty": 0,
                    "selected_metric": "exact_match",
                    "selected_metric_value": 1.0,
                    "tolerance": tolerance,
                },
                "matched_rows": 0,
                "score": 1.0,
                "total_rows": 0,
            },
        )
        return

    truth_columns = list(truth[0].keys())
    submission_columns = list(submission[0].keys()) if submission else []
    missing_columns = [column for column in truth_columns if column not in submission_columns]
    if missing_columns:
        reject_submission(
            output_dir,
            f"Submission missing required columns: {','.join(missing_columns)}",
            {"missing_columns": missing_columns},
        )

    total_rows = len(truth)
    comparable_rows = min(len(truth), len(submission))
    matched_rows = 0
    for row_index in range(comparable_rows):
        truth_row = truth[row_index]
        submission_row = submission[row_index]
        row_matches = True
        for column in truth_columns:
            truth_value = truth_row.get(column)
            submission_value = submission_row.get(column)
            if truth_value == "" and submission_value == "":
                continue
            if truth_value is not None and submission_value is not None:
                try:
                    numeric_truth = float(truth_value)
                    numeric_submission = float(submission_value)
                    if not math.isclose(
                        numeric_truth,
                        numeric_submission,
                        abs_tol=tolerance,
                        rel_tol=0.0,
                    ):
                        row_matches = False
                        break
                    continue
                except (TypeError, ValueError):
                    pass
            if str(truth_value) != str(submission_value):
                row_matches = False
                break
        if row_matches:
            matched_rows += 1

    mismatched_row_penalty = abs(len(truth) - len(submission))
    denominator = total_rows if total_rows > 0 else max(len(submission), 1)
    score = max(matched_rows - mismatched_row_penalty, 0) / denominator
    deterministic_json_write(
        output_dir,
        {
            "ok": True,
            "details": {
                "comparison_kind": "csv_table",
                "comparable_rows": comparable_rows,
                "mismatched_row_penalty": mismatched_row_penalty,
                "selected_metric": "exact_match",
                "selected_metric_value": float(round(score, 12)),
                "tolerance": tolerance,
            },
            "matched_rows": matched_rows,
            "score": float(round(score, 12)),
            "total_rows": int(total_rows),
        },
    )


def run_exact_match_json(input_dir: Path, output_dir: Path) -> None:
    runtime = load_runtime_config(input_dir, output_dir)
    evaluation_path = runtime["evaluation_path"]
    submission_path = runtime["submission_path"]
    if evaluation_path is None:
        fail_runtime(output_dir, "Runtime config evaluation bundle is required.")
    truth = read_json_document(evaluation_path, "Evaluation bundle", output_dir, True)
    submission = read_json_document(submission_path, "Submission", output_dir, False)
    matched = truth == submission
    score = 1.0 if matched else 0.0
    deterministic_json_write(
        output_dir,
        {
            "ok": True,
            "details": {
                "comparison_kind": "json_file",
                "selected_metric": "exact_match",
                "selected_metric_value": score,
            },
            "matched_rows": 1 if matched else 0,
            "score": score,
            "total_rows": 1,
        },
    )


def run_exact_match_binary(input_dir: Path, output_dir: Path) -> None:
    runtime = load_runtime_config(input_dir, output_dir)
    evaluation_path = runtime["evaluation_path"]
    submission_path = runtime["submission_path"]
    if evaluation_path is None:
        fail_runtime(output_dir, "Runtime config evaluation bundle is required.")
    truth = read_binary_document(evaluation_path, "Evaluation bundle", output_dir, True)
    submission = read_binary_document(submission_path, "Submission", output_dir, False)
    matched = truth == submission
    score = 1.0 if matched else 0.0
    deterministic_json_write(
        output_dir,
        {
            "ok": True,
            "details": {
                "comparison_kind": "opaque_file",
                "selected_metric": "exact_match",
                "selected_metric_value": score,
                "expected_bytes": len(truth),
                "submitted_bytes": len(submission),
            },
            "matched_rows": 1 if matched else 0,
            "score": score,
            "total_rows": 1,
        },
    )


def run_structured_record_validation(input_dir: Path, output_dir: Path) -> None:
    runtime = load_runtime_config(input_dir, output_dir)
    evaluation_path = runtime["evaluation_path"]
    submission_path = runtime["submission_path"]
    if evaluation_path is None:
        fail_runtime(output_dir, "Runtime config evaluation bundle is required.")
    rubric_document = read_json_document(evaluation_path, "Evaluation bundle", output_dir, True)
    submission = read_json_document(submission_path, "Submission", output_dir, False)
    if not isinstance(submission, dict):
        reject_submission(
            output_dir,
            "Submission must be a JSON object.",
            {"comparison_kind": "json_record"},
        )

    rubric = parse_structured_record_rubric(rubric_document, output_dir)
    required_fields = rubric["required_fields"]
    non_empty_array_fields = rubric["non_empty_array_fields"]
    allowed_string_values = rubric["allowed_string_values"]
    checks_passed = 0
    failed_checks: list[str] = []

    for field in required_fields:
        if has_present_value(submission.get(field)):
            checks_passed += 1
        else:
            failed_checks.append(f"missing_or_empty:{field}")

    for field in non_empty_array_fields:
        value = submission.get(field)
        if isinstance(value, list) and len(value) > 0:
            checks_passed += 1
        else:
            failed_checks.append(f"array_required:{field}")

    for field, allowed_values in allowed_string_values.items():
        value = submission.get(field)
        if isinstance(value, str) and value in allowed_values:
            checks_passed += 1
        else:
            failed_checks.append(f"allowed_value:{field}")

    checks_total = (
        len(required_fields)
        + len(non_empty_array_fields)
        + len(allowed_string_values)
    )
    score = checks_passed / checks_total
    deterministic_json_write(
        output_dir,
        {
            "ok": True,
            "details": {
                "comparison_kind": "json_record",
                "selected_metric": "validation_score",
                "selected_metric_value": float(round(score, 12)),
                "checks_passed": checks_passed,
                "checks_total": checks_total,
                "failed_checks": failed_checks,
            },
            "matched_rows": checks_passed,
            "score": float(round(score, 12)),
            "total_rows": checks_total,
        },
    )


def run_bundle_manifest_validation(input_dir: Path, output_dir: Path) -> None:
    runtime = load_runtime_config(input_dir, output_dir)
    evaluation_path = runtime["evaluation_path"]
    submission_path = runtime["submission_path"]
    if evaluation_path is None:
        fail_runtime(output_dir, "Runtime config evaluation bundle is required.")

    rubric_document = read_json_document(evaluation_path, "Evaluation bundle", output_dir, True)
    rubric = parse_bundle_manifest_rubric(rubric_document, output_dir)
    bundle_paths, total_uncompressed_bytes = list_zip_entries(
        submission_path, output_dir
    )
    bundle_path_set = set(bundle_paths)
    checks_passed = 0
    failed_checks: list[str] = []

    for required_path in rubric["required_paths"]:
        if required_path in bundle_path_set:
            checks_passed += 1
        else:
            failed_checks.append(f"missing_path:{required_path}")

    for forbidden_path in rubric["forbidden_paths"]:
        if forbidden_path not in bundle_path_set:
            checks_passed += 1
        else:
            failed_checks.append(f"forbidden_path:{forbidden_path}")

    for extension in rubric["required_extensions"]:
        if any(path.endswith(extension) for path in bundle_paths):
            checks_passed += 1
        else:
            failed_checks.append(f"missing_extension:{extension}")

    max_total_uncompressed_bytes = rubric["max_total_uncompressed_bytes"]
    if max_total_uncompressed_bytes is not None:
        if total_uncompressed_bytes <= max_total_uncompressed_bytes:
            checks_passed += 1
        else:
            failed_checks.append("max_total_uncompressed_bytes")

    max_file_count = rubric["max_file_count"]
    if max_file_count is not None:
        if len(bundle_paths) <= max_file_count:
            checks_passed += 1
        else:
            failed_checks.append("max_file_count")

    checks_total = (
        len(rubric["required_paths"])
        + len(rubric["forbidden_paths"])
        + len(rubric["required_extensions"])
        + (1 if max_total_uncompressed_bytes is not None else 0)
        + (1 if max_file_count is not None else 0)
    )
    score = checks_passed / checks_total
    deterministic_json_write(
        output_dir,
        {
            "ok": True,
            "details": {
                "comparison_kind": "bundle_manifest",
                "selected_metric": "validation_score",
                "selected_metric_value": float(round(score, 12)),
                "checks_passed": checks_passed,
                "checks_total": checks_total,
                "failed_checks": failed_checks,
                "bundle_file_count": len(bundle_paths),
                "bundle_total_uncompressed_bytes": total_uncompressed_bytes,
            },
            "matched_rows": checks_passed,
            "score": float(round(score, 12)),
            "total_rows": checks_total,
        },
    )


def run_structured_table_metric(input_dir: Path, output_dir: Path) -> None:
    runtime = load_runtime_config(input_dir, output_dir)
    evaluation_path = runtime["evaluation_path"]
    submission_path = runtime["submission_path"]
    if evaluation_path is None:
        fail_runtime(output_dir, "Runtime config evaluation bundle is required.")

    metric = runtime["metric"]
    if metric not in NUMERIC_METRICS | CLASSIFICATION_METRICS:
        fail_runtime(
            output_dir,
            f"Unsupported metric {metric}. Next step: choose one of {','.join(sorted(NUMERIC_METRICS | CLASSIFICATION_METRICS))}.",
        )

    submission_contract = _require_csv_contract(
        runtime["submission_contract"], "submission_contract", output_dir
    )
    evaluation_contract = _require_csv_contract(
        runtime["evaluation_contract"], "evaluation_contract", output_dir
    )
    policies = runtime["policies"]
    if not isinstance(policies, dict):
        fail_runtime(output_dir, "Runtime config policies must be an object.")
    coverage_policy = policies.get("coverage_policy", "ignore")
    duplicate_id_policy = policies.get("duplicate_id_policy", "ignore")
    invalid_value_policy = policies.get("invalid_value_policy", "ignore")
    policies = {
        "coverage_policy": coverage_policy,
        "duplicate_id_policy": duplicate_id_policy,
        "invalid_value_policy": invalid_value_policy,
    }

    truth_rows = read_csv_rows(evaluation_path, "Evaluation bundle", output_dir, True)
    sub_rows = read_csv_rows(submission_path, "Submission", output_dir, False)
    _validate_header(
        truth_rows,
        evaluation_contract,
        evaluation_path.name,
        output_dir,
        runtime_error=True,
    )
    _validate_header(
        sub_rows,
        submission_contract,
        submission_path.name,
        output_dir,
        runtime_error=False,
    )

    numeric_values = metric in NUMERIC_METRICS
    truth_ids, truth_map = _build_truth_map(
        truth_rows,
        evaluation_contract,
        numeric_values=numeric_values,
        output_dir=output_dir,
    )
    valid_predictions, summary = _summarize_submission(
        sub_rows,
        submission_contract,
        truth_map,
        policies,
        numeric_values=numeric_values,
        output_dir=output_dir,
    )

    if metric in CLASSIFICATION_METRICS:
        y_true: list[str] = []
        y_pred: list[str] = []
        for row_id in truth_ids:
            if row_id not in valid_predictions:
                continue
            y_true.append(str(truth_map[row_id]))
            y_pred.append(str(valid_predictions[row_id]))

        n = len(y_true)
        if n == 0:
            reject_submission(
                output_dir,
                "No valid prediction rows matched the evaluation bundle.",
                summary,
            )

        accuracy = sum(1 for truth, pred in zip(y_true, y_pred) if truth == pred) / n
        f1 = compute_macro_f1(y_true, y_pred)
        selected_metric_value = accuracy if metric == "accuracy" else f1
        leaderboard_score = normalize_score(metric, selected_metric_value, output_dir)
        deterministic_json_write(
            output_dir,
            {
                "ok": True,
                "score": float(round(leaderboard_score, 12)),
                "details": {
                    **summary,
                    "matched_rows": n,
                    "accuracy": float(round(accuracy, 12)),
                    "f1": float(round(f1, 12)),
                    "selected_metric": metric,
                    "selected_metric_value": float(round(selected_metric_value, 12)),
                    "leaderboard_score": float(round(leaderboard_score, 12)),
                },
            },
        )
        return

    y_true: list[float] = []
    y_pred: list[float] = []
    for row_id in truth_ids:
        if row_id not in valid_predictions:
            continue
        y_true.append(float(truth_map[row_id]))
        y_pred.append(float(valid_predictions[row_id]))

    n = len(y_true)
    if n == 0:
        reject_submission(
            output_dir,
            "No valid prediction rows matched the evaluation bundle.",
            summary,
        )

    mean_true = sum(y_true) / n
    mean_pred = sum(y_pred) / n
    ss_res = sum((t - p) ** 2 for t, p in zip(y_true, y_pred))
    ss_tot = sum((t - mean_true) ** 2 for t in y_true)
    rmse = math.sqrt(ss_res / n)
    mae = sum(abs(t - p) for t, p in zip(y_true, y_pred)) / n
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    r2_clamped = max(r2, 0.0)
    std_true = math.sqrt(sum((t - mean_true) ** 2 for t in y_true) / n)
    std_pred = math.sqrt(sum((p - mean_pred) ** 2 for p in y_pred) / n)
    if std_true > 0 and std_pred > 0:
        cov = sum((t - mean_true) * (p - mean_pred) for t, p in zip(y_true, y_pred)) / n
        pearson = cov / (std_true * std_pred)
    else:
        pearson = 0.0

    ranks_true = rankdata(y_true)
    ranks_pred = rankdata(y_pred)
    mean_rank_true = sum(ranks_true) / n
    mean_rank_pred = sum(ranks_pred) / n
    cov_rank = sum(
        (rt - mean_rank_true) * (rp - mean_rank_pred)
        for rt, rp in zip(ranks_true, ranks_pred)
    ) / n
    std_rank_true = math.sqrt(sum((rt - mean_rank_true) ** 2 for rt in ranks_true) / n)
    std_rank_pred = math.sqrt(sum((rp - mean_rank_pred) ** 2 for rp in ranks_pred) / n)
    if std_rank_true > 0 and std_rank_pred > 0:
        spearman = cov_rank / (std_rank_true * std_rank_pred)
    else:
        spearman = 0.0

    metric_values = {
        "r2": float(round(r2, 12)),
        "rmse": float(round(rmse, 12)),
        "mae": float(round(mae, 12)),
        "pearson": float(round(pearson, 12)),
        "spearman": float(round(spearman, 12)),
    }
    selected_metric_value = metric_values[metric]
    leaderboard_score = normalize_score(metric, selected_metric_value, output_dir)
    deterministic_json_write(
        output_dir,
        {
            "ok": True,
            "score": float(round(leaderboard_score, 12)),
            "details": {
                **summary,
                "matched_rows": n,
                "r2": metric_values["r2"],
                "r2_clamped": float(round(r2_clamped, 12)),
                "rmse": metric_values["rmse"],
                "mae": metric_values["mae"],
                "pearson": metric_values["pearson"],
                "spearman": metric_values["spearman"],
                "selected_metric": metric,
                "selected_metric_value": float(round(selected_metric_value, 12)),
                "leaderboard_score": float(round(leaderboard_score, 12)),
            },
        },
    )
