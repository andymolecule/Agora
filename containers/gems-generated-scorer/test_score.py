import importlib.util
import json
import tempfile
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT_DIR / "containers" / "gems-generated-scorer" / "score.py"


def load_module():
    spec = importlib.util.spec_from_file_location("generated_runner", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def write_runtime_config(input_dir: Path, mount: dict, metric: str, submission_contract: dict, evaluation_contract: dict | None = None):
    payload = {
        "version": "v1",
        "metric": metric,
        "mount": mount,
        "submission_contract": submission_contract,
        "policies": {
            "coverage_policy": "reject",
            "duplicate_id_policy": "reject",
            "invalid_value_policy": "reject",
        },
    }
    if evaluation_contract is not None:
        payload["evaluation_contract"] = evaluation_contract
    (input_dir / "agora-runtime.json").write_text(json.dumps(payload), encoding="utf-8")


def run_exact_match_json_case():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        (input_dir / "ground_truth.json").write_text('{"answer":42}', encoding="utf-8")
        (input_dir / "submission.json").write_text('{"answer":42}', encoding="utf-8")
        (input_dir / "generated_scorer.py").write_text(
            "from agora_generated_runtime import run_exact_match_json\n\n"
            "def score(input_dir, output_dir):\n"
            "    run_exact_match_json(input_dir, output_dir)\n",
            encoding="utf-8",
        )
        write_runtime_config(
            input_dir,
            {"evaluation_bundle_name": "ground_truth.json", "submission_file_name": "submission.json"},
            "exact_match",
            {
                "kind": "opaque_file",
                "file": {"extension": ".json", "mime": "application/json", "max_bytes": 1024},
            },
        )
        module.INPUT_DIR = input_dir
        module.OUTPUT_DIR = output_dir
        module.OUTPUT_PATH = output_dir / "score.json"
        module.GENERATED_SCORER_PATH = input_dir / "generated_scorer.py"
        module.main()
        payload = json.loads((output_dir / "score.json").read_text(encoding="utf-8"))
        assert payload["ok"] is True
        assert payload["score"] == 1.0


def run_structured_record_case():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        (input_dir / "ground_truth.json").write_text(
            json.dumps(
                {
                    "required_fields": ["incident_id", "severity"],
                    "allowed_string_values": {"severity": ["low", "high"]},
                }
            ),
            encoding="utf-8",
        )
        (input_dir / "submission.json").write_text(
            json.dumps({"incident_id": "inc-1", "severity": "high"}),
            encoding="utf-8",
        )
        (input_dir / "generated_scorer.py").write_text(
            "from agora_generated_runtime import run_structured_record_validation\n\n"
            "def score(input_dir, output_dir):\n"
            "    run_structured_record_validation(input_dir, output_dir)\n",
            encoding="utf-8",
        )
        write_runtime_config(
            input_dir,
            {"evaluation_bundle_name": "ground_truth.json", "submission_file_name": "submission.json"},
            "validation_score",
            {
                "kind": "opaque_file",
                "file": {"extension": ".json", "mime": "application/json", "max_bytes": 1024},
            },
        )
        module.INPUT_DIR = input_dir
        module.OUTPUT_DIR = output_dir
        module.OUTPUT_PATH = output_dir / "score.json"
        module.GENERATED_SCORER_PATH = input_dir / "generated_scorer.py"
        module.main()
        payload = json.loads((output_dir / "score.json").read_text(encoding="utf-8"))
        assert payload["ok"] is True
        assert payload["score"] == 1.0


def run_tabular_case():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        (input_dir / "ground_truth.csv").write_text("id,label\ns1,1.0\ns2,3.0\n", encoding="utf-8")
        (input_dir / "submission.csv").write_text("id,prediction\ns1,1.0\ns2,3.0\n", encoding="utf-8")
        (input_dir / "generated_scorer.py").write_text(
            "from agora_generated_runtime import run_structured_table_metric\n\n"
            "def score(input_dir, output_dir):\n"
            "    run_structured_table_metric(input_dir, output_dir)\n",
            encoding="utf-8",
        )
        write_runtime_config(
            input_dir,
            {"evaluation_bundle_name": "ground_truth.csv", "submission_file_name": "submission.csv"},
            "rmse",
            {
                "kind": "csv_table",
                "columns": {
                    "required": ["id", "prediction"],
                    "id": "id",
                    "value": "prediction",
                    "allow_extra": True,
                },
            },
            {
                "kind": "csv_table",
                "columns": {
                    "required": ["id", "label"],
                    "id": "id",
                    "value": "label",
                    "allow_extra": True,
                },
            },
        )
        module.INPUT_DIR = input_dir
        module.OUTPUT_DIR = output_dir
        module.OUTPUT_PATH = output_dir / "score.json"
        module.GENERATED_SCORER_PATH = input_dir / "generated_scorer.py"
        module.main()
        payload = json.loads((output_dir / "score.json").read_text(encoding="utf-8"))
        assert payload["ok"] is True
        assert payload["score"] == 1.0


def run_bundle_manifest_case():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        (input_dir / "judge_rubric.json").write_text(
            json.dumps(
                {
                    "required_paths": ["README.md", "src/main.py"],
                    "required_extensions": [".py"],
                    "max_file_count": 3,
                }
            ),
            encoding="utf-8",
        )
        with zipfile.ZipFile(input_dir / "submission.zip", "w") as archive:
            archive.writestr("README.md", "# Bundle\n")
            archive.writestr("src/main.py", "print('ok')\n")
        (input_dir / "generated_scorer.py").write_text(
            "from agora_generated_runtime import run_bundle_manifest_validation\n\n"
            "def score(input_dir, output_dir):\n"
            "    run_bundle_manifest_validation(input_dir, output_dir)\n",
            encoding="utf-8",
        )
        write_runtime_config(
            input_dir,
            {"evaluation_bundle_name": "judge_rubric.json", "submission_file_name": "submission.zip"},
            "validation_score",
            {
                "kind": "opaque_file",
                "file": {"extension": ".zip", "mime": "application/zip", "max_bytes": 1024},
            },
        )
        module.INPUT_DIR = input_dir
        module.OUTPUT_DIR = output_dir
        module.OUTPUT_PATH = output_dir / "score.json"
        module.GENERATED_SCORER_PATH = input_dir / "generated_scorer.py"
        module.main()
        payload = json.loads((output_dir / "score.json").read_text(encoding="utf-8"))
        assert payload["ok"] is True
        assert payload["score"] == 1.0


run_exact_match_json_case()
run_structured_record_case()
run_tabular_case()
run_bundle_manifest_case()
