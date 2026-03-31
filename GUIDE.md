# BTS Forecast Dashboard - What's Included

This package contains everything you need to deploy a live, auto-updating dashboard for your back-to-school forecast analysis.

---

## 📦 What's in the Package

### 1. **Interactive Dashboard** (`dashboard/index.html`)
A clean, professional web interface that shows:
- Summary cards (supply problems, utilization problems, on track)
- Interactive table with all 343 subjects
- Filter by problem type
- Search by subject name
- Click column headers to sort
- Color-coded by problem type (red = supply, orange = utilization, green = on track)

**Try it now:** Just double-click `dashboard/index.html` to see it working locally!

---

### 2. **Automation Scripts** (`scripts/`)

**`run_analysis.py`** - Core analysis logic
- Loads run rate, forecast, and utilization data
- Calculates smoothed monthly targets
- Classifies subjects as supply vs. utilization problems
- Generates dashboard data (JSON format)

**`fetch_looker_data.py`** - Looker API integration
- Pulls run rate data from Looker
- Pulls utilization data from Looker  
- Saves as CSVs for analysis script
- **You need to add your Looker query IDs** (see SETUP.md)

---

### 3. **GitHub Actions Workflow** (`.github/workflows/update-dashboard.yml`)

**What it does:**
- Runs every Monday at 1 AM your time (6 AM UTC)
- Executes the automation flow:
  1. Fetch latest Looker data (run rates + utilization)
  2. Read Pierre's forecast (from data/monitoring_table.xlsx)
  3. Run analysis (smoothing + problem classification)
  4. Generate dashboard data.json
  5. Deploy to GitHub Pages (live site updates automatically)

**Manual triggers:**
- Runs when you upload new data files to GitHub
- Can trigger manually from Actions tab anytime

---

### 4. **Sample Data** (`data/`)
Includes your current analysis data so you can:
- Test the dashboard locally before deploying
- See the expected file formats
- Have a working dashboard immediately

**Files included:**
- `run_rates.csv` - Your Dec-Mar 2026 tutor contracting data
- `utilization.csv` - Your Feb-Mar 2026 utilization data
- `monitoring_table.xlsx` - Pierre's current forecast
- `analysis_results.csv` - Pre-computed analysis (so dashboard works right away)

---

### 5. **Documentation**

**`SETUP.md`** - Step-by-step setup guide (10 minutes to deploy)
**`README.md`** - Full documentation and reference
**`requirements.txt`** - Python dependencies

---

## 🚀 How It Works (The Flow)

### Initial Setup (You do once):
```
1. Create GitHub repo
2. Upload these files
3. Add Looker API credentials as secrets
4. Enable GitHub Pages
5. Run first workflow
→ Dashboard goes live!
```

### Weekly Updates (Automatic):
```
Every Monday 1 AM CST:
1. GitHub Action triggers
2. Pulls fresh Looker data (run rates + utilization)
3. Reads Pierre's forecast (you upload manually when he sends it)
4. Runs analysis
5. Updates dashboard
→ Fresh data for WBR prep!
```

### When Pierre Updates Forecast:
```
1. Download his monitoring_table.xlsx
2. Upload to data/monitoring_table.xlsx in GitHub
3. Commit
→ Dashboard rebuilds with new forecast in 2-3 minutes
```

---

## 🎯 What Makes This Powerful

### For You (Leigh):
- ✅ No more manual analysis every week
- ✅ Consistent methodology (same logic every time)
- ✅ Version controlled (track changes over time)
- ✅ Shareable link (send to anyone)
- ✅ Always fresh for WBR prep

### For Kevin/Darren:
- ✅ Live dashboard they can check anytime
- ✅ Filter to see only their areas of concern
- ✅ Sort by gap size to prioritize
- ✅ Clear problem type classification

### For Cindy (Supply Team):
- ✅ See which subjects need recruiting vs. algorithm fixes
- ✅ Consistent monthly targets (no more spikes)
- ✅ Can check progress week-over-week

---

## 📊 Dashboard Features

### Summary Cards (Top of Page)
- Total subjects analyzed
- How many are utilization problems (fix algorithm first)
- How many are true supply problems (need recruitment)
- How many are on track

### Interactive Table
**Columns:**
- Subject name
- Run Rate (Dec-Mar 2026 average)
- Smoothed Target (consistent monthly goal)
- Utilization % (30-day)
- Gap % (how far over capacity)
- Problem Type (utilization vs. supply)
- Recommended Action

**Interactions:**
- **Click column headers** to sort
- **Use dropdown** to filter by problem type
- **Search box** to find specific subjects
- **Color coding** to quickly identify issues

---

## 🔄 Update Cadence

### Automated (Weekly):
- **Monday 1 AM CST:** Fresh run rate and utilization data from Looker
- **Uses:** Latest monitoring_table.xlsx you've uploaded

### Manual (As Needed):
- **When Pierre updates forecast:** Upload new monitoring_table.xlsx
- **Any time you want:** Trigger workflow manually from Actions tab

---

## 💡 Pro Tips

### Before Your First WBR:
1. Deploy the dashboard
2. Share link with Kevin/Darren ahead of time
3. They can explore data before meeting
4. Makes WBR discussion more focused

### For Deeper Analysis:
1. Download `analysis_results.csv` from the data folder
2. Has full month-by-month detail
3. Can pull into Google Sheets for custom views

### Version History:
- Every update creates a new commit
- Can see how forecasts change over time
- Can revert to old data if needed

---

## Next Steps

1. **Follow SETUP.md** to deploy (takes 10 minutes)
2. **Test the dashboard** locally first (double-click index.html)
3. **Share the live link** with your team once deployed
4. **Set calendar reminder** to upload Pierre's forecast when he sends it

---

**Questions?** Check README.md for full docs or troubleshooting section.

**Ready?** Open SETUP.md and let's get this deployed! 🚀
