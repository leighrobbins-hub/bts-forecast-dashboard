# Setup Guide: 10-Minute Deployment

Follow these steps to get your live dashboard running.

---

## Step 1: Create GitHub Repository (2 minutes)

1. Go to https://github.com/new
2. Repository name: `bts-forecast-dashboard`
3. Description: "Back-to-School Forecast Analysis Dashboard"
4. **Public** repository (so GitHub Pages works free)
5. Click "Create repository"

---

## Step 2: Upload Files to GitHub (3 minutes)

### Option A: Via GitHub Web Interface (Easiest)

1. On your new repo page, click "uploading an existing file"
2. Drag all folders from `bts-forecast-dashboard/` into the upload area:
   - `.github/` folder
   - `scripts/` folder
   - `dashboard/` folder
   - `data/` folder
   - `README.md`
   - `requirements.txt`
   - `.gitignore`
3. Commit message: "Initial setup"
4. Click "Commit changes"

### Option B: Via Command Line (If you have Git installed)

```bash
cd path/to/bts-forecast-dashboard
git init
git add .
git commit -m "Initial setup"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/bts-forecast-dashboard.git
git push -u origin main
```

---

## Step 3: Add Looker API Credentials (2 minutes)

1. In your GitHub repo, go to **Settings** → **Secrets and variables** → **Actions**
2. Click "New repository secret"
3. Add these secrets:

| Secret name | Value |
|---|---|
| `LOOKER_CLIENT_ID` | Your Looker API client ID |
| `LOOKER_CLIENT_SECRET` | Your Looker API client secret |
| `LOOKER_API_URL` | `https://varsitytutors.looker.com` |
| `LOOKER_RUN_RATE_LOOK_ID` | Look ID for run rate data (see Step 4) |
| `LOOKER_UTILIZATION_LOOK_ID` | Look ID for utilization data (see Step 4) |

### How to Get Looker API Credentials:

1. Log into Looker
2. Go to **Admin** → **Users** → select your user (or a service account) → **Edit API Keys**
3. Click **New API Key** — you'll get a Client ID and Client Secret
4. Save both securely (the secret is only shown once!)

**Note:** If you don't have permission to create API keys, ask your Looker admin for access.

---

## Step 4: Find Your Look IDs (2 minutes)

Look IDs are the recommended way to connect to Looker because they stay stable even when the underlying query is edited.

1. Open Looker at `https://varsitytutors.looker.com`
2. Navigate to the saved Look that contains your data
3. The Look ID is in the URL: `https://varsitytutors.looker.com/looks/12345` → the ID is **12345**
4. Add the IDs as GitHub secrets (`LOOKER_RUN_RATE_LOOK_ID`, `LOOKER_UTILIZATION_LOOK_ID`)

**Don't have a saved Look yet?**
1. Go to **Explore** in Looker
2. Build your query (run rate or utilization data)
3. Click **Save** → **As a Look** and give it a descriptive name
4. Grab the numeric ID from the URL

**Alternative — use raw Query IDs instead:**
If you prefer, you can set `LOOKER_RUN_RATE_QUERY_ID` and `LOOKER_UTILIZATION_QUERY_ID` as secrets. These are the `qid=` values from Explore URLs (e.g., `?qid=AbCdEfGhIjK`). Note that query IDs change every time a Look is edited, so Look IDs are more reliable.

---

## Step 5: Enable GitHub Pages (1 minute)

1. In repo, go to **Settings** → **Pages**
2. Under "Source": Select "Deploy from a branch"
3. Branch: Select `gh-pages` (it will be created automatically)
4. Click "Save"

---

## Step 6: Run First Update (1 minute)

1. Go to **Actions** tab
2. Click "Update BTS Forecast Dashboard" workflow
3. Click "Run workflow" → "Run workflow"
4. Wait 2-3 minutes for it to complete (green checkmark)

---

## Step 7: View Your Dashboard! 🎉

Your dashboard is now live at:
**https://YOUR-USERNAME.github.io/bts-forecast-dashboard/**

Bookmark this link and share with your team!

---

## What Happens Next

### Every Monday at 1 AM CST (Automatic):
- GitHub Action runs
- Pulls latest Looker data
- Runs analysis
- Updates dashboard
- You wake up to fresh data for WBR prep!

### When Pierre Updates His Forecast:
1. Download `monitoring_table_wide.xlsx` from Pierre
2. In GitHub repo, go to `data/` folder
3. Click "Add file" → "Upload files"
4. Upload the new `monitoring_table.xlsx`
5. Commit
6. Dashboard auto-updates in 2-3 minutes

---

## Testing Locally (Optional)

Want to test before deploying?

```bash
# Install Python dependencies
pip install -r requirements.txt

# Copy .env.example to .env and fill in your credentials
cp .env.example .env
# Edit .env with your Looker Client ID, Secret, and Look IDs

# Source environment variables
export $(grep -v '^#' .env | xargs)

# Test Looker connection without overwriting data
python scripts/fetch_looker_data.py --dry-run

# Fetch data for real
python scripts/fetch_looker_data.py

# Run analysis locally
python scripts/run_analysis.py

# Serve the dashboard (file:// URLs may not work due to CORS)
python -m http.server 8080 --directory dashboard
# Open http://localhost:8080 in your browser
```

---

## Troubleshooting

### "Action failed" - Looker API Error
- Check that secrets are set correctly
- Verify query IDs are updated
- **Fallback:** Upload CSVs manually to `data/` folder

### Dashboard shows "Error loading data"
- Wait 5 minutes and refresh (GitHub Pages can be slow)
- Check Actions tab for errors
- Verify `data.json` was created (look in gh-pages branch)

### "gh-pages branch not found"
- Run the workflow at least once
- GitHub creates this branch automatically
- Refresh Pages settings after first Action completes

---

## Need Help?

- Check the main README.md for full documentation
- Review GitHub Actions logs in the "Actions" tab
- Test locally first to isolate issues

---

**You're done! The dashboard will auto-update every Monday morning. Share the link with Kevin, Darren, and Cindy.** 🚀
