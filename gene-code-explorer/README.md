# Gene Code Explorer + Nexus Academy

Static learning games (life science, math, ELA) and the Nexus meta-hub. This folder is the **canonical home** for these pages—separate from the BTS Forecast app in `dashboard/`.

**Entry points**

- `nexus.html` — Nexus Academy (all three games)
- `hub.html` — Gene Code Explorer chapters

**Regenerate math/ELA unit HTML** (after editing `scripts/generate-realm-units.py`):

```bash
cd gene-code-explorer && python3 scripts/generate-realm-units.py
```

**Deploy:** GitHub Actions merges this folder with `dashboard/` (forecast app) into one site on `gh-pages`. See `.github/workflows/deploy-dashboard-site.yml`.
