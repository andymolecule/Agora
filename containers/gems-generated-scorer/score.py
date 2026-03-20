"""
Agora generated scorer runner.

This image delegates scoring to a mounted Python module at /input/generated_scorer.py.
The generated scorer is expected to produce /output/score.json using the same
deterministic contract as other Agora official scorers.
"""

import json
import subprocess
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


def main() -> None:
    if not GENERATED_SCORER_PATH.exists():
        fail_runtime(
            "Missing /input/generated_scorer.py. Next step: mount the generated scorer entrypoint before running gems-generated-scorer."
        )

    result = subprocess.run(
        ["python", str(GENERATED_SCORER_PATH)],
        cwd=str(INPUT_DIR),
        check=False,
    )

    if not OUTPUT_PATH.exists():
        fail_runtime(
            "Generated scorer did not produce /output/score.json. Next step: update the generated scorer entrypoint to write the standard score payload."
        )

    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
