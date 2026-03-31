# Data Directory Format

## actuals/

One CSV file per month. Filename format: `YYYY-MM.csv`

Example: `2026-04.csv` for April 2026 actuals.

**Columns:**

| Column | Description |
|--------|-------------|
| Subject | Subject name (must match forecast subject names exactly) |
| Actual_Contracted | Number of tutors actually contracted that month |

**Example:**

```csv
Subject,Actual_Contracted
SAT,28
High School Chemistry,12
AP Pre-Calculus,4
```

## forecasts/

Versioned copies of the forecast file (monitoring_table.xlsx). These are saved
automatically when a new forecast is uploaded. Filename format:
`YYYY-MM-DD_<version>.xlsx`

## Source Files (root of data/)

| File | Description |
|------|-------------|
| monitoring_table.xlsx | Current forecast from Pierre (V1.4 model) |
| run_rates.csv | Looker export: new tutor contracting by subject by month |
| utilization.csv | Looker export: tutor assignment timing (30d/60d/90d) |
| analysis_results.csv | Generated output from run_analysis.py |
