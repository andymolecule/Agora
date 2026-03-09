# Test Data

Human-oriented fixture kits for posting and testing Agora challenge types through the web UI.

For end-to-end stabilization work, also use:
- [PHASE1-HARDENING-CHECKLIST.md](/Users/changyuesin/Agora/challenges/test-data/PHASE1-HARDENING-CHECKLIST.md)

Each subdirectory is organized around one category and contains:
- a realistic posting walkthrough
- concrete files to upload in the UI
- one or more sample solver submissions
- notes on what the current codebase actually supports versus what is still scaffold-only

## Directory Layout

```text
test-data/
  prediction/        fully executable prediction fixture kit
  reproducibility/   fully executable reproducibility fixture kit
  docking/           realistic posting kit; current scorer is still a placeholder
  optimization/      realistic posting kit; requires a custom scorer image
  red_team/          realistic posting kit; requires a custom scorer image
  custom/            generic custom bounty posting kit; requires a custom scorer image
```

## How To Use These Folders

1. Pick a category directory.
2. Read its `README.md` first.
3. Use the listed files while posting through `/post`.
4. Submit the provided sample solver output.
5. Compare the observed behavior with the expected outcomes documented in that folder.

## Support Status By Category

| Category | Current status | Notes |
|----------|----------------|-------|
| Prediction | Executable | Uses the regression scorer already in `containers/regression-scorer` |
| Reproducibility | Executable | Uses the repro scorer already in `containers/repro-scorer` |
| Docking | Posting scaffold | Official preset exists, but `containers/docking-scorer` is still a placeholder |
| Optimization | Posting scaffold | Relies on a poster-supplied custom scorer image |
| Red Team | Posting scaffold | Relies on a poster-supplied custom scorer image |
| Custom | Posting scaffold | Fully bring-your-own scoring contract |

## Why This Structure Exists

The goal is to keep human testing honest.

Where the repo already has a real scorer, the fixture folder tells you how to test end to end.
Where the repo does not yet have a real scorer, the fixture folder still helps you test posting UX, data organization, and solver-format expectations without pretending the scoring layer is complete.
