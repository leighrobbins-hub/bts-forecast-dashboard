# Gene Code Explorer + Nexus Academy

Static learning games (life science, math, ELA) and the Nexus meta-hub. This folder is the **canonical home** for these pages—separate from the BTS Forecast app in `dashboard/`.

**Where this folder is**

- On disk the directory is **`gene-code-explorer/`** (hyphens; full word *explorer*), at the **repo root**—sibling of `dashboard/`, **not** inside `dashboard/`.
- **Nexus** lives here as `nexus.html`, `nexus-scores.html`, and `js/nexus-academy.js`.
- If your editor only has **`dashboard/`** open as the workspace, you will **not** see this folder in the file tree. Use **File → Open Folder** and open **`bts-forecast-dashboard`** (the repository root) instead.

**Entry points**

- `nexus.html` — Nexus Academy (all three games)
- `hub.html` — Gene Code Explorer chapters

**Regenerate math/ELA unit HTML** (after editing `scripts/generate-realm-units.py`):

```bash
cd gene-code-explorer && python3 scripts/generate-realm-units.py
```

**Deploy:** GitHub Actions merges this folder with `dashboard/` (forecast app) into one site on `gh-pages`. See `.github/workflows/deploy-dashboard-site.yml`.

**GitHub Pages URL (this repo)** — files from `gene-code-explorer/` are published at the **site root**, not under a `GeneCode-Explorer/` path. Use your **repository name** in the URL:

- Nexus: `https://leighrobbins-hub.github.io/bts-forecast-dashboard/nexus.html`
- BTS forecast: `https://leighrobbins-hub.github.io/bts-forecast-dashboard/` (or `index.html`)

There is no separate `GeneCode-Explorer` project site in this setup; `GeneCode-Explorer` in the URL will 404.
