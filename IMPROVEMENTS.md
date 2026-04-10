# BTS Dashboard — Autoresearch Improvement Log
> Uncommitted changes. Review with `git diff`. Commit what you like.

| # | File(s) | Change | Status | Reason |
|---|---------|--------|--------|--------|
| 1 | `scripts/run_analysis.py` | Added `_norm_subject()` helper; applies strip + internal-space collapse to all subject name lookups and the utilization merge | **keep** | Bug: case/whitespace differences between Looker exports and Excel silently dropped subjects from analysis |
| 2 | `scripts/run_analysis.py` | Replaced hard-coded Feb/Mar utilization month pairs with dynamic detection from CSV column headers (`YYYY-MM` / `YYYY-MM.1` pattern) | **keep** | Bug: if Looker exports different months the hard-coded dict silently contributed zero utilization for all subjects |
| 3 | `scripts/run_analysis.py` | Added `subjects_with_util_data` and `util_coverage_pct` fields to the `summary` block in `data.json` | **keep** | No visibility into how many subjects were missing utilization data; now surfaced to dashboard |
| 4 | `dashboard/app.js`, `dashboard/index.html`, `dashboard/styles.css` | Added data-quality coverage badge on Overview tab showing `XX% (N/M subjects have util data)` colour-coded green/amber/red | **keep** | Direct follow-on from Loop 3; makes the quality score visible without opening dev tools |
| 5 | `scripts/fetch_looker_data.py`, `scripts/run_analysis.py`, `dashboard/app.js`, `dashboard/styles.css` | `fetch_looker_data.py` now writes `data/fetch_status.json`; analysis script embeds it in `data.json`; dashboard shows a yellow warning banner when any Looker source failed | **keep** | Bug: `continue-on-error: true` in GitHub Action meant Looker failures were completely invisible; dashboard showed stale data with no indication |
| 6 | `scripts/run_analysis.py` | Added timestamped archive copy of `analysis_results.csv` to `data/analysis_archive/` on each run | **keep** | `analysis_results.csv` was overwritten every run with no rollback path; archive adds audit trail at negligible cost |
| 7 | `dashboard/app.js` | Fixed `renderPriorityTable` filter — was `Problem_Type.includes('Problem')` which excluded all "Possible Placement Issue" subjects; now uses `classifyType()` check | **keep** | Bug: 24 placement-issue subjects never appeared in the Top Priority table |
| 8 | `tests/test_analysis.py` | Added `TestNormSubject` (4 tests) and `TestClassifyProblemsWithMismatchedCase` (2 tests) | **keep** | Verify Loop 1 fix works; all 30 tests pass |

## Review

```bash
git diff                          # see all changes
git diff dashboard/               # just the frontend
git diff scripts/                 # just the backend
git diff tests/                   # just the tests
.venv/bin/python -m unittest discover -s tests -v   # run tests
```
