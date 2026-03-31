"""
Back-to-School Forecast Analysis Script
Processes run rates, forecasts, utilization, and monthly actuals to generate
dashboard data with monthly tracking and historical performance.
"""

import pandas as pd
import numpy as np
import json
import glob
import os
import shutil
from datetime import datetime
import sys


BTS_MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
BTS_MONTH_KEYS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
BTS_MONTH_DATES = [
    datetime(2026, 4, 1), datetime(2026, 5, 1), datetime(2026, 6, 1),
    datetime(2026, 7, 1), datetime(2026, 8, 1), datetime(2026, 9, 1),
    datetime(2026, 10, 1)
]


def load_and_clean_data(run_rate_path, forecast_path, utilization_path):
    """Load and parse all input data files"""

    df_runrate_raw = pd.read_csv(run_rate_path)
    df_runrate = df_runrate_raw.iloc[1:].reset_index(drop=True)
    df_runrate.columns = ['Subject'] + df_runrate_raw.columns[1:].tolist()

    clean_months = ['2026-03', '2026-02', '2026-01', '2025-12']
    for col in clean_months:
        df_runrate[col] = pd.to_numeric(df_runrate[col], errors='coerce')

    df_runrate['Run_Rate'] = df_runrate[clean_months].mean(axis=1)
    df_runrate = df_runrate[['Subject', 'Run_Rate']].copy()
    df_runrate = df_runrate[df_runrate['Run_Rate'] > 0]

    df_forecast = pd.read_excel(forecast_path)
    df_forecast = df_forecast[df_forecast['metric'] == 'forecasted_headcount'].copy()

    df_util_raw = pd.read_csv(utilization_path)
    df_util = df_util_raw.iloc[1:].reset_index(drop=True)
    df_util.columns = ['Subject'] + df_util_raw.columns[1:].tolist()

    feb_mar_months = {
        'Mar': ('2026-03', '2026-03.1'),
        'Feb': ('2026-02', '2026-02.1')
    }

    util_data = []
    for _, row in df_util.iterrows():
        subject = row['Subject']
        total = 0
        utilized = 0

        for month, (total_col, util_col) in feb_mar_months.items():
            t = pd.to_numeric(row[total_col], errors='coerce')
            u = pd.to_numeric(row[util_col], errors='coerce')
            if pd.notna(t):
                total += t
            if pd.notna(u):
                utilized += u

        if total > 0:
            util_data.append({
                'Subject': subject,
                'Total_Contracted': total,
                'Utilized_30d': utilized,
                'Util_Rate': (utilized / total * 100)
            })

    df_utilization = pd.DataFrame(util_data)

    return df_runrate, df_forecast, df_utilization


def load_actuals(actuals_dir):
    """Load all monthly actuals CSVs from data/actuals/"""
    actuals = {}
    pattern = os.path.join(actuals_dir, '*.csv')
    for filepath in sorted(glob.glob(pattern)):
        filename = os.path.basename(filepath)
        month_key = filename.replace('.csv', '')
        if month_key not in BTS_MONTH_KEYS:
            print(f"  Skipping {filename} (not a BTS month)")
            continue
        try:
            df = pd.read_csv(filepath)
            if 'Subject' not in df.columns or 'Actual_Contracted' not in df.columns:
                print(f"  Warning: {filename} missing required columns (Subject, Actual_Contracted)")
                continue
            month_data = {}
            for _, row in df.iterrows():
                subject = str(row['Subject']).strip()
                val = pd.to_numeric(row['Actual_Contracted'], errors='coerce')
                if pd.notna(val):
                    month_data[subject] = int(val)
            actuals[month_key] = month_data
            print(f"  Loaded actuals for {month_key}: {len(month_data)} subjects")
        except Exception as e:
            print(f"  Error loading {filename}: {e}")
    return actuals


def calculate_smoothed_forecasts(df_forecast, df_runrate):
    """Calculate smoothed monthly targets from forecast data"""

    results = []

    for _, forecast_row in df_forecast.iterrows():
        subject = forecast_row['subject_name']

        runrate_row = df_runrate[df_runrate['Subject'] == subject]
        if len(runrate_row) == 0:
            continue

        run_rate = runrate_row['Run_Rate'].values[0]
        if pd.isna(run_rate) or run_rate == 0:
            continue

        original_forecasts = []
        for month in BTS_MONTH_DATES:
            val = forecast_row[month]
            original_forecasts.append(float(val) if pd.notna(val) else 0)

        total_demand = sum(original_forecasts)
        if total_demand == 0:
            continue

        target_per_month = total_demand / len(BTS_MONTH_DATES)
        max_capacity = run_rate * 1.2
        gap_pct = ((target_per_month - run_rate) / run_rate * 100) if run_rate > 0 else 0
        needs_external = target_per_month > max_capacity

        results.append({
            'Subject': subject,
            'Run_Rate': round(run_rate, 0),
            'Smoothed_Target': round(target_per_month, 0),
            'Max_Capacity': round(max_capacity, 0),
            'Gap_Pct': round(gap_pct, 0),
            'Needs_External_Levers': needs_external,
            'BTS_Total': round(total_demand, 0),
            'Apr_Original': round(original_forecasts[0], 0),
            'May_Original': round(original_forecasts[1], 0),
            'Jun_Original': round(original_forecasts[2], 0),
            'Jul_Original': round(original_forecasts[3], 0),
            'Aug_Original': round(original_forecasts[4], 0),
            'Sep_Original': round(original_forecasts[5], 0),
            'Oct_Original': round(original_forecasts[6], 0)
        })

    return pd.DataFrame(results)


def classify_problems(df_analysis, df_utilization):
    """Classify subjects as supply vs utilization problems"""

    df_merged = df_analysis.merge(df_utilization, on='Subject', how='left')

    def get_problem_type(row):
        util_rate = row['Util_Rate']
        needs_external = row['Needs_External_Levers']

        if pd.isna(util_rate):
            if needs_external:
                return "Supply Problem (No Util Data)"
            else:
                return "On Track"

        if util_rate < 50:
            if needs_external:
                return "Utilization Problem"
            else:
                return "On Track (Low Util)"
        else:
            if needs_external:
                return "True Supply Problem"
            else:
                return "On Track"

    df_merged['Problem_Type'] = df_merged.apply(get_problem_type, axis=1)
    df_merged['Util_Rate'] = df_merged['Util_Rate'].round(0)

    return df_merged


def calculate_monthly_tracker(df_final, actuals):
    """Build per-subject monthly tracker with adjusted targets based on actuals."""

    tracker_subjects = []

    for _, row in df_final.iterrows():
        subject = row['Subject']
        bts_total = row.get('BTS_Total', 0)
        if pd.isna(bts_total):
            bts_total = 0
        bts_total = float(bts_total)
        smoothed = row.get('Smoothed_Target', 0)
        if pd.isna(smoothed):
            smoothed = 0

        original_keys = ['Apr_Original', 'May_Original', 'Jun_Original',
                         'Jul_Original', 'Aug_Original', 'Sep_Original', 'Oct_Original']
        originals = [float(row.get(k, 0)) if pd.notna(row.get(k, 0)) else 0 for k in original_keys]

        months_data = []
        actual_so_far = 0
        months_with_actuals = 0

        for i, month_key in enumerate(BTS_MONTH_KEYS):
            actual = None
            if month_key in actuals and subject in actuals[month_key]:
                actual = actuals[month_key][subject]
                actual_so_far += actual
                months_with_actuals += 1

            months_data.append({
                'month': month_key,
                'label': BTS_MONTH_LABELS[i],
                'original_forecast': originals[i],
                'smoothed_target': float(smoothed),
                'actual': actual,
                'adjusted_target': None,
                'variance': None
            })

        remaining_need = bts_total - actual_so_far
        months_left = len(BTS_MONTH_KEYS) - months_with_actuals

        for md in months_data:
            if md['actual'] is not None:
                md['variance'] = md['actual'] - md['smoothed_target']
                md['adjusted_target'] = md['smoothed_target']
            else:
                if months_left > 0:
                    md['adjusted_target'] = round(remaining_need / months_left, 1)
                else:
                    md['adjusted_target'] = 0

        tracker_subjects.append({
            'subject': subject,
            'run_rate': float(row.get('Run_Rate', 0)),
            'bts_total': bts_total,
            'smoothed_target': float(smoothed),
            'actual_to_date': actual_so_far,
            'remaining_need': remaining_need,
            'months_completed': months_with_actuals,
            'problem_type': row.get('Problem_Type', 'On Track'),
            'months': months_data
        })

    return tracker_subjects


def generate_history(tracker_subjects, actuals):
    """Generate month-by-month aggregate performance history."""

    history = []
    cumulative_target = 0
    cumulative_actual = 0

    for i, month_key in enumerate(BTS_MONTH_KEYS):
        if month_key not in actuals:
            continue

        month_target = 0
        month_actual = 0
        over_performers = []
        under_performers = []

        for ts in tracker_subjects:
            md = ts['months'][i]
            target = md['smoothed_target']
            actual = md['actual']
            if actual is None:
                continue

            month_target += target
            month_actual += actual
            variance = actual - target
            if variance >= 3:
                over_performers.append({'subject': ts['subject'], 'variance': variance})
            elif variance <= -3:
                under_performers.append({'subject': ts['subject'], 'variance': variance})

        cumulative_target += month_target
        cumulative_actual += month_actual
        variance_pct = ((month_actual - month_target) / month_target * 100) if month_target > 0 else 0

        over_performers.sort(key=lambda x: -x['variance'])
        under_performers.sort(key=lambda x: x['variance'])

        history.append({
            'month': month_key,
            'label': BTS_MONTH_LABELS[i],
            'total_target': round(month_target, 0),
            'total_actual': round(month_actual, 0),
            'variance': round(month_actual - month_target, 0),
            'variance_pct': round(variance_pct, 1),
            'cumulative_target': round(cumulative_target, 0),
            'cumulative_actual': round(cumulative_actual, 0),
            'over_performers': over_performers[:5],
            'under_performers': under_performers[:5]
        })

    return history


def build_upload_log(actuals_dir, forecasts_dir):
    """Build a log of uploaded files."""
    uploads = []

    for filepath in sorted(glob.glob(os.path.join(actuals_dir, '*.csv'))):
        filename = os.path.basename(filepath)
        month_key = filename.replace('.csv', '')
        mtime = os.path.getmtime(filepath)
        df = pd.read_csv(filepath)
        uploads.append({
            'type': 'actuals',
            'month': month_key,
            'filename': filename,
            'uploaded_at': datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M'),
            'subjects_count': len(df)
        })

    for filepath in sorted(glob.glob(os.path.join(forecasts_dir, '*.xlsx'))):
        filename = os.path.basename(filepath)
        mtime = os.path.getmtime(filepath)
        uploads.append({
            'type': 'forecast',
            'month': None,
            'filename': filename,
            'uploaded_at': datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M'),
            'subjects_count': None
        })

    return uploads


def generate_dashboard_data(df_final, tracker_subjects, history, uploads):
    """Generate JSON data for dashboard including monthly tracker."""

    summary = {
        'total_subjects': len(df_final),
        'utilization_problems': len(df_final[df_final['Problem_Type'] == 'Utilization Problem']),
        'supply_problems': len(df_final[df_final['Problem_Type'] == 'True Supply Problem']),
        'on_track': len(df_final[df_final['Problem_Type'].str.contains('On Track')]),
        'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M UTC')
    }

    portfolio_bts_total = sum(ts['bts_total'] for ts in tracker_subjects)
    portfolio_actual = sum(ts['actual_to_date'] for ts in tracker_subjects)
    months_with_data = max((ts['months_completed'] for ts in tracker_subjects), default=0)

    summary['portfolio_bts_total'] = round(portfolio_bts_total, 0)
    summary['portfolio_actual_to_date'] = round(portfolio_actual, 0)
    summary['portfolio_remaining'] = round(portfolio_bts_total - portfolio_actual, 0)
    summary['months_completed'] = months_with_data
    summary['months_remaining'] = len(BTS_MONTH_KEYS) - months_with_data

    records = df_final.to_dict('records')
    # Scrub NaN → None so json.dump writes null instead of NaN (which breaks JS)
    for rec in records:
        for k, v in rec.items():
            if isinstance(v, float) and np.isnan(v):
                rec[k] = None

    return {
        'summary': summary,
        'subjects': records,
        'monthly_tracker': tracker_subjects,
        'history': history,
        'uploads': uploads,
        'bts_months': BTS_MONTH_KEYS,
        'bts_month_labels': BTS_MONTH_LABELS
    }


def version_forecast(forecast_path, forecasts_dir):
    """Copy current forecast to versioned storage."""
    if not os.path.exists(forecast_path):
        return
    timestamp = datetime.now().strftime('%Y-%m-%d')
    dest = os.path.join(forecasts_dir, f'{timestamp}_forecast.xlsx')
    counter = 1
    while os.path.exists(dest):
        dest = os.path.join(forecasts_dir, f'{timestamp}_forecast_v{counter}.xlsx')
        counter += 1
    shutil.copy2(forecast_path, dest)
    print(f"  Forecast versioned as {os.path.basename(dest)}")


def main():
    print("Starting BTS Forecast Analysis...")

    run_rate_path = 'data/run_rates.csv'
    forecast_path = 'data/monitoring_table.xlsx'
    utilization_path = 'data/utilization.csv'
    actuals_dir = 'data/actuals'
    forecasts_dir = 'data/forecasts'

    os.makedirs(actuals_dir, exist_ok=True)
    os.makedirs(forecasts_dir, exist_ok=True)

    print("Loading data...")
    df_runrate, df_forecast, df_utilization = load_and_clean_data(
        run_rate_path, forecast_path, utilization_path
    )

    print("Loading actuals...")
    actuals = load_actuals(actuals_dir)
    if actuals:
        print(f"  Found actuals for {len(actuals)} month(s): {', '.join(sorted(actuals.keys()))}")
    else:
        print("  No actuals uploaded yet")

    print("Calculating smoothed forecasts...")
    df_analysis = calculate_smoothed_forecasts(df_forecast, df_runrate)

    print("Classifying problems...")
    df_final = classify_problems(df_analysis, df_utilization)

    print("Building monthly tracker...")
    tracker_subjects = calculate_monthly_tracker(df_final, actuals)

    print("Generating performance history...")
    history = generate_history(tracker_subjects, actuals)

    print("Building upload log...")
    uploads = build_upload_log(actuals_dir, forecasts_dir)

    print("Generating dashboard data...")
    dashboard_data = generate_dashboard_data(df_final, tracker_subjects, history, uploads)

    df_final.to_csv('data/analysis_results.csv', index=False)

    with open('dashboard/data.json', 'w') as f:
        json.dump(dashboard_data, f, indent=2)

    with open('dashboard/data.json.js', 'w') as f:
        f.write('window.__dashboardData = ')
        json.dump(dashboard_data, f, indent=2)
        f.write(';\n')

    summary = dashboard_data['summary']
    print(f"\nAnalysis complete!")
    print(f"  {summary['total_subjects']} subjects analyzed")
    print(f"  {summary['utilization_problems']} utilization problems")
    print(f"  {summary['supply_problems']} true supply problems")
    print(f"  BTS Total: {summary['portfolio_bts_total']}")
    print(f"  Actual to date: {summary['portfolio_actual_to_date']}")
    print(f"  Months completed: {summary['months_completed']} / {len(BTS_MONTH_KEYS)}")
    print(f"  Dashboard data written to dashboard/data.json")


if __name__ == "__main__":
    main()
