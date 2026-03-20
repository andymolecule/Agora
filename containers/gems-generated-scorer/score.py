import importlib.util
import json
import sys
from pathlib import Path

INPUT_DIR = Path("/input")
OUTPUT_DIR = Path("/output")
OUTPUT_PATH = OUTPUT_DIR / "score.json"
GENERATED_SCORER_PATH = INPUT_DIR / "generated_scorer.py"


def deterministic_json_write(payload: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


def fail_runtime(message: str) -> None:
    deterministic_json_write({"ok": False, "score": 0.0, "error": message, "details": {}})
    raise SystemExit(1)


def load_generated_scorer():
    if not GENERATED_SCORER_PATH.exists():
      fail_runtime("Missing generated scorer program: /input/generated_scorer.py")

    module_dir = str(Path(__file__).resolve().parent)
    if module_dir not in sys.path:
        sys.path.insert(0, module_dir)

    spec = importlib.util.spec_from_file_location(
        "generated_scorer_module", GENERATED_SCORER_PATH
    )
    if spec is None or spec.loader is None:
        fail_runtime("Failed to load generated scorer program.")

    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except SystemExit:
        raise
    except Exception as error:
        fail_runtime(f"Generated scorer import failed: {error}")

    score_fn = getattr(module, "score", None)
    if not callable(score_fn):
        fail_runtime(
            "Generated scorer program must define callable score(input_dir, output_dir)."
        )
    return score_fn


def main() -> None:
    score_fn = load_generated_scorer()
    try:
        score_fn(INPUT_DIR, OUTPUT_DIR)
    except SystemExit:
        raise
    except Exception as error:
        fail_runtime(f"Generated scorer execution failed: {error}")

    if not OUTPUT_PATH.exists():
        fail_runtime("Generated scorer did not write /output/score.json.")

    try:
        json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail_runtime(f"Generated scorer wrote invalid JSON: {error.msg}")


if __name__ == "__main__":
    main()
