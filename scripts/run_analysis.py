"""
Back-to-School Forecast Analysis Script
Processes run rates, forecasts, and utilization data to generate dashboard data
"""

import pandas as pd
import numpy as np
import json
from datetime import datetime
import sys

def load_and_clean_data(run_rate_path, forecast_path, utilization_path):
    """Load and parse all input data files"""
    
    # Load run rate data
    df_runrate_raw = pd.read_csv(run_rate_path)
    df_runrate = df_runrate_raw.iloc[1:].reset_index(drop=True)
    df_runrate.columns = ['Subject'] + df_runrate_raw.columns[1:].tolist()
    
    # Calculate Dec-Mar 2026 average
    clean_months = ['2026-03', '2026-02', '2026-01', '2025-12']
    for col in clean_months:
        df_runrate[col] = pd.to_numeric(df_runrate[col], errors='coerce')
    
    df_runrate['Run_Rate'] = df_runrate[clean_months].mean(axis=1)
    df_runrate = df_runrate[['Subject', 'Run_Rate']].copy()
    df_runrate = df_runrate[df_runrate['Run_Rate'] > 0]
    
    # Load forecast data
    df_forecast = pd.read_excel(forecast_path)
    df_forecast = df_forecast[df_forecast['metric'] == 'forecasted_headcount'].copy()
    
    # Load utilization data
    df_util_raw = pd.read_csv(utilization_path)
    df_util = df_util_raw.iloc[1:].reset_index(drop=True)
    df_util.columns = ['Subject'] + df_util_raw.columns[1:].tolist()
    
    # Calculate Feb-Mar utilization
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

def calculate_smoothed_forecasts(df_forecast, df_runrate):
    """Calculate smoothed monthly targets from forecast data"""
    
    bts_months = [
        datetime(2026, 4, 1), datetime(2026, 5, 1), datetime(2026, 6, 1),
        datetime(2026, 7, 1), datetime(2026, 8, 1), datetime(2026, 9, 1), datetime(2026, 10, 1)
    ]
    
    results = []
    
    for _, forecast_row in df_forecast.iterrows():
        subject = forecast_row['subject_name']
        
        # Get run rate
        runrate_row = df_runrate[df_runrate['Subject'] == subject]
        if len(runrate_row) == 0:
            continue
        
        run_rate = runrate_row['Run_Rate'].values[0]
        if pd.isna(run_rate) or run_rate == 0:
            continue
        
        # Extract original forecasts
        original_forecasts = []
        for month in bts_months:
            val = forecast_row[month]
            original_forecasts.append(float(val) if pd.notna(val) else 0)
        
        total_demand = sum(original_forecasts)
        if total_demand == 0:
            continue
        
        # Calculate smoothed target
        target_per_month = total_demand / len(bts_months)
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
    
    # Merge utilization data
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

def generate_dashboard_data(df_final):
    """Generate JSON data for dashboard"""
    
    # Summary stats
    summary = {
        'total_subjects': len(df_final),
        'utilization_problems': len(df_final[df_final['Problem_Type'] == 'Utilization Problem']),
        'supply_problems': len(df_final[df_final['Problem_Type'] == 'True Supply Problem']),
        'on_track': len(df_final[df_final['Problem_Type'].str.contains('On Track')]),
        'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M UTC')
    }
    
    # Convert to records for dashboard
    records = df_final.to_dict('records')
    
    return {
        'summary': summary,
        'subjects': records
    }

def main():
    print("Starting BTS Forecast Analysis...")
    
    # Paths (update these based on your setup)
    run_rate_path = 'data/run_rates.csv'
    forecast_path = 'data/monitoring_table.xlsx'
    utilization_path = 'data/utilization.csv'
    
    # Load data
    print("Loading data...")
    df_runrate, df_forecast, df_utilization = load_and_clean_data(
        run_rate_path, forecast_path, utilization_path
    )
    
    # Calculate smoothed forecasts
    print("Calculating smoothed forecasts...")
    df_analysis = calculate_smoothed_forecasts(df_forecast, df_runrate)
    
    # Classify problems
    print("Classifying problems...")
    df_final = classify_problems(df_analysis, df_utilization)
    
    # Generate dashboard data
    print("Generating dashboard data...")
    dashboard_data = generate_dashboard_data(df_final)
    
    # Save outputs
    df_final.to_csv('data/analysis_results.csv', index=False)
    
    with open('dashboard/data.json', 'w') as f:
        json.dump(dashboard_data, f, indent=2)
    
    with open('dashboard/data.json.js', 'w') as f:
        f.write('window.__dashboardData = ')
        json.dump(dashboard_data, f, indent=2)
        f.write(';\n')
    
    summary = dashboard_data['summary']
    print(f"✓ Analysis complete!")
    print(f"  - {summary['total_subjects']} subjects analyzed")
    print(f"  - {summary['utilization_problems']} utilization problems")
    print(f"  - {summary['supply_problems']} true supply problems")
    print(f"  - Dashboard data written to dashboard/data.json")

if __name__ == "__main__":
    main()
