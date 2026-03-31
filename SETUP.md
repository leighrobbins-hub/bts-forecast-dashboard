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
3. Add these three secrets:

**Secret 1:**
- Name: `LOOKER_CLIENT_ID`
- Value: Your Looker API client ID

**Secret 2:**
- Name: `LOOKER_CLIENT_SECRET`
- Value: Your Looker API client secret

**Secret 3:**
- Name: `LOOKER_API_URL`
- Value: `https://varsitytutors.looker.com`

### How to Get Looker API Credentials:

1. Log into Looker
2. Click your profile → Edit
3. Scroll to "API Keys" section
4. Click "New API3 Key"
5. Copy the Client ID and Client Secret (save them securely - secret only shows once!)

**Note:** If you don't have permission to create API keys, ask your Looker admin for access.

---

## Step 4: Update Looker Query IDs (2 minutes)

1. In your GitHub repo, click `scripts/fetch_looker_data.py`
2. Click the pencil icon to edit
3. Find line 55 and update with your run rate query ID:
   ```python
   QUERY_ID = "OoJHXx9GMJbQoLFMN7t105"  # Your actual query ID
   ```
4. Find line 72 and update with your utilization query ID
5. Commit changes

**How to find query IDs:**
- Open your Looker look: https://varsitytutors.looker.com/looks/25848
- The query ID is `25848`
- Or for explores: `?qid=OoJHXx9GMJbQoLFMN7t105` → query ID is the part after `qid=`

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

# Run analysis locally
python scripts/run_analysis.py

# Open dashboard locally
open dashboard/index.html
# (or just double-click index.html in your file browser)
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
