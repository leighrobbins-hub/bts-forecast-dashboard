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
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import sys

CST = ZoneInfo('America/Chicago')


BTS_MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
BTS_MONTH_KEYS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
BTS_MONTH_DATES = [
    datetime(2026, 4, 1), datetime(2026, 5, 1), datetime(2026, 6, 1),
    datetime(2026, 7, 1), datetime(2026, 8, 1), datetime(2026, 9, 1),
    datetime(2026, 10, 1)
]


def _find_goal_column(df):
    for c in df.columns:
        cl = str(c).strip().lower()
        if cl in ('goal', 'bts goal', 'total goal', 'season goal', 'bts_total', 'season total'):
            return c
    return None


def load_and_clean_data(run_rate_path, forecast_path, utilization_path):
    """Load and parse all input data files"""

    df_runrate_raw = pd.read_csv(run_rate_path)
    cols = [c.strip() for c in df_runrate_raw.columns]
    df_runrate_raw.columns = cols

    if 'Subject Name - General' in cols or 'Total Count Likely Attanable' in cols:
        # New simple two-column format: subject name + single run rate value
        subj_col = [c for c in cols if 'subject' in c.lower() or 'name' in c.lower()][0]
        rate_col = [c for c in cols if c != subj_col][0]
        df_runrate = df_runrate_raw.rename(columns={subj_col: 'Subject', rate_col: 'Run_Rate'})
        df_runrate['Run_Rate'] = pd.to_numeric(df_runrate['Run_Rate'], errors='coerce')
        df_runrate['Mar_Actual'] = None
        df_runrate = df_runrate[['Subject', 'Run_Rate', 'Mar_Actual']].copy()
        df_runrate = df_runrate[df_runrate['Run_Rate'] > 0]
    else:
        # Legacy multi-column monthly format
        df_runrate = df_runrate_raw.iloc[1:].reset_index(drop=True)
        df_runrate.columns = ['Subject'] + df_runrate_raw.columns[1:].tolist()
        clean_months = ['2026-03', '2026-02', '2026-01', '2025-12']
        for col in clean_months:
            if col in df_runrate.columns:
                df_runrate[col] = pd.to_numeric(df_runrate[col], errors='coerce')
        available = [c for c in clean_months if c in df_runrate.columns]
        df_runrate['Run_Rate'] = df_runrate[available].mean(axis=1)
        df_runrate['Mar_Actual'] = df_runrate['2026-03'] if '2026-03' in df_runrate.columns else None
        df_runrate = df_runrate[['Subject', 'Run_Rate', 'Mar_Actual']].copy()
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
    """Load all monthly actuals CSVs and per-month status from data/actuals/"""
    actuals = {}
    statuses = {}

    status_path = os.path.join(actuals_dir, 'status.json')
    if os.path.exists(status_path):
        try:
            with open(status_path) as f:
                statuses = json.load(f)
        except Exception as e:
            print(f"  Warning: could not read status.json: {e}")

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
            status = statuses.get(month_key, 'in_progress')
            print(f"  Loaded actuals for {month_key}: {len(month_data)} subjects [{status}]")
        except Exception as e:
            print(f"  Error loading {filename}: {e}")
    return actuals, statuses


def _normalize_csv_columns(df):
    """Strip whitespace / BOM from column names so 'Final Forecast' matches exports."""
    df = df.copy()
    df.columns = [str(c).strip().lstrip('\ufeff') for c in df.columns]
    return df


def load_manual_adjustments(adjustments_dir):
    """Load per-month manual forecast adjustment CSVs.

    Each file is named by month key (e.g. 2026-04.csv). The monthly value comes
    from **Final Forecast** (required for normal goal-sheet exports). Optional
    Goal/BTS Goal columns are only used when Final Forecast is blank for legacy
    sheets. Other months stay zero for brand-new subjects until another month
    file sets them.

    Returns:
        adjustments: {month_key: {subject_name: value_for_that_month}}
    """
    adjustments = {}
    for filepath in sorted(glob.glob(os.path.join(adjustments_dir, '*.csv'))):
        filename = os.path.basename(filepath)
        month_key = filename.replace('.csv', '')
        if month_key not in BTS_MONTH_KEYS:
            continue
        try:
            df = _normalize_csv_columns(pd.read_csv(filepath))
        except Exception as e:
            print(f"  Warning: could not read {filename}: {e}")
            continue

        name_col = None
        for candidate in ['Subject Name', 'subject_name', 'Subject']:
            if candidate in df.columns:
                name_col = candidate
                break
        forecast_col = None
        for candidate in ['Final Forecast', 'final_forecast', 'Final_Forecast', 'Forecast', 'forecast']:
            if candidate in df.columns:
                forecast_col = candidate
                break
        goal_col = _find_goal_column(df)

        if name_col is None or (forecast_col is None and goal_col is None):
            print(f"  Warning: {filename} missing required columns (need 'Subject Name' and 'Final Forecast' and/or Goal)")
            continue

        month_adj = {}
        for _, row in df.iterrows():
            subject = str(row[name_col]).strip()
            if not subject:
                continue
            month_val = None
            if forecast_col is not None:
                val = pd.to_numeric(row[forecast_col], errors='coerce')
                if pd.notna(val):
                    month_val = float(val)
            if month_val is None and goal_col is not None:
                gv = pd.to_numeric(row[goal_col], errors='coerce')
                if pd.notna(gv):
                    month_val = float(gv)
            if month_val is not None:
                month_adj[subject] = month_val
        adjustments[month_key] = month_adj
        print(f"  Loaded {len(month_adj)} adjustments for {month_key}")

    # Also support legacy single-file format (manual_adjustments.csv)
    legacy_path = os.path.join(adjustments_dir, 'manual_adjustments.csv')
    if os.path.exists(legacy_path):
        try:
            df = _normalize_csv_columns(pd.read_csv(legacy_path))
            name_col = None
            for candidate in ['Subject Name', 'subject_name', 'Subject']:
                if candidate in df.columns:
                    name_col = candidate
                    break
            forecast_col = None
            for candidate in ['Final Forecast', 'final_forecast', 'Final_Forecast', 'Forecast', 'forecast']:
                if candidate in df.columns:
                    forecast_col = candidate
                    break
            goal_col = _find_goal_column(df)
            if name_col and (forecast_col or goal_col):
                count = 0
                for _, row in df.iterrows():
                    subject = str(row[name_col]).strip()
                    if not subject:
                        continue
                    month_val = None
                    if forecast_col is not None:
                        val = pd.to_numeric(row[forecast_col], errors='coerce')
                        if pd.notna(val):
                            month_val = float(val)
                    if month_val is None and goal_col is not None:
                        gv = pd.to_numeric(row[goal_col], errors='coerce')
                        if pd.notna(gv):
                            month_val = float(gv)
                    if month_val is None:
                        continue
                    for mk in BTS_MONTH_KEYS:
                        if mk not in adjustments:
                            adjustments[mk] = {}
                        if subject not in adjustments[mk]:
                            adjustments[mk][subject] = month_val
                            count += 1
                if count > 0:
                    print(f"  Legacy manual_adjustments.csv: applied {count} overrides")
        except Exception:
            pass

    total = sum(len(v) for v in adjustments.values())
    if total > 0:
        print(f"  Total: {total} subject-month adjustments across {len(adjustments)} months")
    return adjustments


def apply_group_smoothing(monthly_targets, run_rate, manual_floors, adjusted_forecasts):
    """Apply 3-month group smoothing to monthly targets.

    Averages within fixed groups when any month exceeds the run-rate cap.
    Keeps demand near peak months to reduce tutor attrition. Manual
    adjustment values act as the floor for each month.

    Args:
        monthly_targets: list of 7 monthly values (mutated in place)
        run_rate: the subject's run rate cap
        manual_floors: list of 7 values (or None) representing manual floors
        adjusted_forecasts: original adjusted forecasts used to decide if
            Group 2 needs correction

    Returns:
        monthly_targets (same list, mutated)
    """
    if run_rate <= 0:
        return monthly_targets

    def _floor(idx):
        f = manual_floors[idx]
        if f is not None and monthly_targets[idx] < f:
            monthly_targets[idx] = f

    # Group 1: Aug(4), Sep(5), Oct(6)
    g1 = [4, 5, 6]
    if any(monthly_targets[i] > run_rate for i in g1):
        total = sum(monthly_targets[i] for i in g1)
        base = int(total // 3)
        rem = int(total - base * 3)
        for i in g1:
            monthly_targets[i] = base
        monthly_targets[g1[1]] += rem
        for i in g1:
            _floor(i)

    # Group 2: May(1), Jun(2), Jul(3)
    g2 = [1, 2, 3]
    g2_corrected = any(adjusted_forecasts[i] > run_rate for i in g2)
    if g2_corrected:
        total = sum(monthly_targets[i] for i in g2)
        base = int(total // 3)
        rem = int(total - base * 3)
        for i in g2:
            monthly_targets[i] = base
        monthly_targets[g2[1]] += rem
        for i in g2:
            _floor(i)

    # April: leave alone if Group 2 had correction.
    # If Group 2 did NOT need correction and Apr > run_rate,
    # cascade excess to May if there's room.
    if not g2_corrected and monthly_targets[0] > run_rate:
        excess = monthly_targets[0] - run_rate
        room = run_rate - monthly_targets[1]
        if room > 0:
            absorb = min(excess, room)
            monthly_targets[0] -= absorb
            monthly_targets[1] += absorb
    _floor(0)

    return monthly_targets


def calculate_smoothed_forecasts(df_forecast, df_runrate, manual_adjustments=None, march_overrides=None):
    """Calculate smoothed monthly targets from forecast data"""
    if manual_adjustments is None:
        manual_adjustments = {}

    results = []
    processed_subjects = set()

    for _, forecast_row in df_forecast.iterrows():
        subject = forecast_row['subject_name']

        runrate_row = df_runrate[df_runrate['Subject'] == subject]
        if len(runrate_row) == 0:
            continue

        run_rate = runrate_row['Run_Rate'].values[0]
        mar_actual = runrate_row['Mar_Actual'].values[0]
        if pd.isna(run_rate) or run_rate == 0:
            continue

        mar_forecast_val = forecast_row.get(datetime(2026, 3, 1))
        mar_forecast = float(mar_forecast_val) if pd.notna(mar_forecast_val) else None

        original_forecasts = []
        for month in BTS_MONTH_DATES:
            val = forecast_row[month]
            original_forecasts.append(float(val) if pd.notna(val) else 0)

        total_demand = sum(original_forecasts)

        # Apply per-month manual adjustments where they exist.
        # Adjusted months use the override; non-adjusted months keep the model forecast.
        adjusted_forecasts = list(original_forecasts)
        is_adjusted = False
        adjusted_months = []
        if manual_adjustments:
            for i, mk in enumerate(BTS_MONTH_KEYS):
                if mk in manual_adjustments and subject in manual_adjustments[mk]:
                    adjusted_forecasts[i] = manual_adjustments[mk][subject]
                    is_adjusted = True
                    adjusted_months.append(BTS_MONTH_LABELS[i])
        original_model_total = total_demand
        total_demand = sum(adjusted_forecasts)

        if total_demand == 0 and original_model_total == 0 and not is_adjusted:
            continue

        monthly_targets = list(adjusted_forecasts)
        manual_floors = [None] * 7
        if manual_adjustments:
            for i, mk in enumerate(BTS_MONTH_KEYS):
                if mk in manual_adjustments and subject in manual_adjustments[mk]:
                    manual_floors[i] = manual_adjustments[mk][subject]

        apply_group_smoothing(monthly_targets, run_rate, manual_floors, adjusted_forecasts)

        target_per_month = total_demand / len(BTS_MONTH_DATES)
        max_capacity = run_rate * 1.2
        total_capacity = run_rate * len(BTS_MONTH_DATES)
        gap_pct = ((target_per_month - run_rate) / run_rate * 100) if run_rate > 0 else 0
        needs_external = target_per_month > max_capacity
        raw_gap = round(total_capacity - total_demand, 0)
        coverage_pct = round(total_capacity / total_demand * 100) if total_demand > 0 else 100

        results.append({
            'Subject': subject,
            'Run_Rate': round(run_rate, 0),
            'Smoothed_Target': round(target_per_month, 0),
            'Max_Capacity': round(max_capacity, 0),
            'Gap_Pct': round(gap_pct, 0),
            'Raw_Gap': raw_gap,
            'Coverage_Pct': coverage_pct,
            'Needs_External_Levers': needs_external,
            'BTS_Total': round(total_demand, 0),
            'Is_Adjusted': is_adjusted,
            'Adjusted_Months': adjusted_months if adjusted_months else None,
            'Original_Model_Total': round(original_model_total, 0),
            'Apr_Original': round(original_forecasts[0], 0),
            'May_Original': round(original_forecasts[1], 0),
            'Jun_Original': round(original_forecasts[2], 0),
            'Jul_Original': round(original_forecasts[3], 0),
            'Aug_Original': round(original_forecasts[4], 0),
            'Sep_Original': round(original_forecasts[5], 0),
            'Oct_Original': round(original_forecasts[6], 0),
            'Apr_Smoothed': round(monthly_targets[0], 0),
            'May_Smoothed': round(monthly_targets[1], 0),
            'Jun_Smoothed': round(monthly_targets[2], 0),
            'Jul_Smoothed': round(monthly_targets[3], 0),
            'Aug_Smoothed': round(monthly_targets[4], 0),
            'Sep_Smoothed': round(monthly_targets[5], 0),
            'Oct_Smoothed': round(monthly_targets[6], 0),
            'Mar_Actual': round(march_overrides[subject]['actual'], 0) if march_overrides and subject in march_overrides and march_overrides[subject]['actual'] is not None else (round(mar_actual, 0) if pd.notna(mar_actual) else None),
            'Mar_Forecast': round(march_overrides[subject]['forecast'], 0) if march_overrides and subject in march_overrides and march_overrides[subject]['forecast'] is not None else (round(mar_forecast, 0) if mar_forecast is not None else None)
        })
        processed_subjects.add(subject)

    # Add subjects from manual adjustments that were not fully processed above: e.g. not in
    # the forecast, or in the forecast but skipped (no run-rate row). Per-month files only
    # set that month; other months stay zero until another file does.
    if manual_adjustments:
        adj_subjects = set()
        for mk in manual_adjustments:
            adj_subjects.update(manual_adjustments[mk].keys())

        new_subjects = adj_subjects - processed_subjects
        for subject in sorted(new_subjects):
            adjusted_forecasts = [0.0] * 7
            adjusted_months = []
            for i, mk in enumerate(BTS_MONTH_KEYS):
                if mk in manual_adjustments and subject in manual_adjustments[mk]:
                    adjusted_forecasts[i] = manual_adjustments[mk][subject]
                    adjusted_months.append(BTS_MONTH_LABELS[i])

            total_demand = sum(adjusted_forecasts)
            if total_demand == 0:
                continue

            runrate_row = df_runrate[df_runrate['Subject'] == subject]
            run_rate = float(runrate_row['Run_Rate'].values[0]) if len(runrate_row) > 0 and pd.notna(runrate_row['Run_Rate'].values[0]) else 0
            mar_actual = float(runrate_row['Mar_Actual'].values[0]) if len(runrate_row) > 0 and pd.notna(runrate_row['Mar_Actual'].values[0]) else None
            # Subjects not yet in run_rates.csv need a baseline for gap / smoothing math.
            if (run_rate == 0 or pd.isna(run_rate)) and total_demand > 0:
                run_rate = max(1.0, round(total_demand / 7.0))

            monthly_targets = list(adjusted_forecasts)
            manual_floors = list(adjusted_forecasts)
            apply_group_smoothing(monthly_targets, run_rate, manual_floors, adjusted_forecasts)

            target_per_month = total_demand / 7
            max_capacity = run_rate * 1.2
            total_capacity = run_rate * 7
            gap_pct = ((target_per_month - run_rate) / run_rate * 100) if run_rate > 0 else 0
            needs_external = target_per_month > max_capacity
            raw_gap = round(total_capacity - total_demand, 0)
            coverage_pct = round(total_capacity / total_demand * 100) if total_demand > 0 else 0

            print(f"  Added new subject from manual adjustments: {subject} (total demand: {total_demand})")

            results.append({
                'Subject': subject,
                'Run_Rate': round(run_rate, 0),
                'Smoothed_Target': round(target_per_month, 0),
                'Max_Capacity': round(max_capacity, 0),
                'Gap_Pct': round(gap_pct, 0),
                'Raw_Gap': raw_gap,
                'Coverage_Pct': coverage_pct,
                'Needs_External_Levers': needs_external,
                'BTS_Total': round(total_demand, 0),
                'Is_Adjusted': True,
                'Adjusted_Months': adjusted_months,
                'Original_Model_Total': 0,
                'Apr_Original': 0, 'May_Original': 0, 'Jun_Original': 0,
                'Jul_Original': 0, 'Aug_Original': 0, 'Sep_Original': 0, 'Oct_Original': 0,
                'Apr_Smoothed': round(monthly_targets[0], 0),
                'May_Smoothed': round(monthly_targets[1], 0),
                'Jun_Smoothed': round(monthly_targets[2], 0),
                'Jul_Smoothed': round(monthly_targets[3], 0),
                'Aug_Smoothed': round(monthly_targets[4], 0),
                'Sep_Smoothed': round(monthly_targets[5], 0),
                'Oct_Smoothed': round(monthly_targets[6], 0),
                'Mar_Actual': round(march_overrides[subject]['actual'], 0) if march_overrides and subject in march_overrides and march_overrides[subject]['actual'] is not None else (round(mar_actual, 0) if mar_actual is not None else None),
                'Mar_Forecast': round(march_overrides[subject]['forecast'], 0) if march_overrides and subject in march_overrides and march_overrides[subject]['forecast'] is not None else None
            })

    return pd.DataFrame(results)


TEST_PREP_KEYWORDS = [
    'ACT', 'SAT', 'GRE', 'GMAT', 'LSAT', 'MCAT', 'ASVAB', 'PSAT', 'SSAT',
    'ISEE', 'SHSAT', 'TEAS', 'Praxis', 'STAAR', 'DAT', 'OAT', 'HSPT',
    'CogAT', 'MAP', 'GED', 'COMLEX', 'PANCE',
]

PROFESSIONAL_KEYWORDS = [
    'CPA', 'CFA', 'CISSP', 'CompTIA', 'NCLEX', 'PMP', 'PTCE', 'VTNE',
    'NPTE', 'OTR', 'BCABA', 'TEFL', 'Series 10', 'Series 24',
    'Nursing', 'ANCC', 'ARDMS', 'ARRT', 'Certification',
    'Police Officer Exam', 'PRAXIS',
]

ELEMENTARY_SUBJECTS = {
    'Kindergarten Readiness', 'Handwriting', 'Phonics',
}

MIDDLE_SCHOOL_SUBJECTS = {
    'Pre-Algebra',
}

HIGH_SCHOOL_SUBJECTS = {
    'Algebra', 'Algebra 2', 'Geometry', 'Pre-Calculus', 'Trigonometry',
    'Math 1', 'Math 2', 'Math 3', 'Earth Science', 'Physical Science',
    'Chemistry', 'Physics', 'Competition Math', 'Functions',
    'English Grammar and Syntax', 'European History',
}

COLLEGE_SUBJECTS = {
    'Calculus 2', 'Calculus 3', 'Multivariable Calculus', 'Business Calculus',
    'Differential Equations', 'Linear Algebra', 'Real Analysis',
    'Discrete Math', 'Discrete Structures', 'Numerical Analysis',
    'Probability', 'Applied Mathematics', 'Finite Mathematics',
    'Statistics', 'Biostatistics', 'Business Statistics',
    'Statistics Graduate Level', 'Quantitative Methods', 'Econometrics',
    'Statics and Dynamics',
    'Organic Chemistry', 'Organic Chemistry 2', 'Inorganic Chemistry',
    'Analytical Chemistry', 'Physical Chemistry', 'General Chemistry 2',
    'Chemistry 2', 'Physics 2',
    'Biochemistry', 'Molecular Biology', 'Cell Biology', 'Genetics',
    'Microbiology', 'Immunology', 'Neuroscience', 'Evolutionary Biology',
    'Anatomy & Physiology', 'Pathophysiology', 'Pharmacology', 'Kinesiology',
    'Biomechanics', 'Cardiology', 'Nutrition', 'Public Health',
    'Aerospace Engineering', 'Biomedical Engineering', 'Chemical Engineering',
    'Civil Engineering', 'Electrical Engineering',
    'Electrical and Computer Engineering', 'Mechanical Engineering',
    'Structural Engineering', 'Materials Science', 'Fluid Mechanics',
    'Heat Transfer', 'Thermodynamics', 'Quantum Physics',
    'Macroeconomics', 'Microeconomics', 'Managerial Economics',
    'Finance', 'Corporate Finance', 'Personal Finance',
    'Financial Accounting', 'Managerial Accounting', 'Cost Accounting',
    'Marketing', 'Management', 'International Business',
    'Business Analytics', 'Supply Chain Management',
    'Project Management/PMP',
    'Psychology', 'Clinical Psychology', 'Sociology', 'Social Work',
    'Philosophy', 'Ethics', 'Theology', 'Linguistics', 'Logic',
    'Criminal Law', 'Civil Procedure', 'Contract Law', 'Legal Writing',
    'Medical Terminology', 'Agricultural Science',
    'Data Science', 'Data Analysis', 'Data Management', 'Data Structures',
    'Machine Learning', 'Artificial Intelligence (AI)', 'Algorithms',
    'Computer Architecture', 'Operating Systems', 'Cyber Security',
    'Information Technology',
    'Java', 'JavaScript', 'Python', 'C', 'C++', 'R Programming',
    'SQL', 'MATLAB', 'HTML', 'Relational Databases', 'Linux',
    'Computer Programming', 'Web Development', 'Web Design',
    'Software', 'Coding',
    'Technical Writing', 'Expository Writing', 'Creative Writing',
    'Fiction Writing', 'Public Speaking',
}

ARTS_AND_MUSIC = {
    'Drawing', 'Painting', 'Photography', 'Fine arts', 'Graphic Design',
    'Animation', 'Filmmaking', 'Music Theory', 'Music Recording',
    'Piano', 'Guitar', 'Trumpet', 'Singing', 'Voice',
    'Adobe Illustrator', 'Photoshop', 'Sketchup', 'Rhino',
    'Autocad', 'Autodesk Fusion 360', 'Autodesk Maya', 'Autodesk Revit',
    'Audio Engineering', 'Digital Media',
}

TECHNOLOGY = {
    'Computer Game Design', 'Video Game Design', 'Minecraft', 'Roblox',
    'Robotics', 'Tableau', 'Microsoft Excel', 'Microsoft Word',
    'Microsoft Power BI', 'Mac Basic Computer Skills',
    'PC Basic Computer Skills', 'Basic Computer Literacy',
    'Social Networking',
}

LANGUAGES = {
    'Spanish 1', 'Spanish 2', 'Spanish 3', 'Spanish 4',
    'French 1', 'French 2', 'French 3', 'French Immersion',
    'Conversational French', 'Conversational Spanish',
    'Conversational German', 'Conversational Italian',
    'German 1', 'German 2', 'Latin 1', 'Latin 2', 'Latin 4',
    'Mandarin Chinese 1', 'Mandarin Chinese 2',
    'Japanese', 'Korean', 'Hebrew', 'Portuguese', 'Polish',
    'Turkish', 'Ukrainian', 'Vietnamese', 'American Sign Language',
    'ESL/ELL',
}


def classify_category(subject):
    """Assign a grade-level / type category based on subject name."""
    s = subject.strip()

    if s.startswith('AP '):
        return 'AP'
    if s.startswith('IB '):
        return 'IB'

    if any(s == kw or s.startswith(kw + ' ') or s.startswith(kw + '-')
           for kw in TEST_PREP_KEYWORDS):
        return 'Test Prep'
    if 'Regents' in s:
        return 'Test Prep'

    if any(kw in s for kw in PROFESSIONAL_KEYWORDS):
        return 'Professional/Cert'

    if s.startswith('Elementary') or s in ELEMENTARY_SUBJECTS:
        return 'Elementary'

    if s.startswith('Middle School') or s.startswith('Middle ') or s in MIDDLE_SCHOOL_SUBJECTS:
        return 'Middle School'
    if 'ISEE- Middle' in s:
        return 'Middle School'

    if (s.startswith('High School') or s in HIGH_SCHOOL_SUBJECTS
            or s.startswith('Grade 10') or s.startswith('Grade 9')):
        return 'High School'
    if s.startswith('Grade 11') or s.startswith('Grade 12'):
        return 'High School'

    if (s.startswith('College') or s in COLLEGE_SUBJECTS):
        return 'College'

    if s in ARTS_AND_MUSIC:
        return 'Arts & Music'
    if s in TECHNOLOGY:
        return 'Technology'
    if s in LANGUAGES:
        return 'Language'

    return 'Other'


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
                return "Possible Placement Issue"
            else:
                return "On Track (Low Util)"
        else:
            if needs_external:
                return "True Supply Problem"
            else:
                return "On Track"

    df_merged['Problem_Type'] = df_merged.apply(get_problem_type, axis=1)
    df_merged['Util_Rate'] = df_merged['Util_Rate'].round(0)
    df_merged['Category'] = df_merged['Subject'].apply(classify_category)

    return df_merged


def calculate_monthly_tracker(df_final, actuals, month_statuses=None):
    """Build per-subject monthly tracker with adjusted targets based on actuals.

    month_statuses: dict mapping month keys to 'in_progress' or 'final'.
    Only 'final' months count toward months_completed and adjusted-target
    recalculation.  In-progress months show actuals but are clearly marked.
    """
    if month_statuses is None:
        month_statuses = {}

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

        smoothed_keys = ['Apr_Smoothed', 'May_Smoothed', 'Jun_Smoothed',
                         'Jul_Smoothed', 'Aug_Smoothed', 'Sep_Smoothed', 'Oct_Smoothed']
        per_month_smoothed = [float(row.get(k, 0)) if pd.notna(row.get(k, 0)) else 0 for k in smoothed_keys]

        months_data = []
        final_actual_sum = 0
        final_months_count = 0

        for i, month_key in enumerate(BTS_MONTH_KEYS):
            actual = None
            status = None
            if month_key in actuals and subject in actuals[month_key]:
                actual = actuals[month_key][subject]
                status = month_statuses.get(month_key, 'in_progress')
                if status == 'final':
                    final_actual_sum += actual
                    final_months_count += 1

            months_data.append({
                'month': month_key,
                'label': BTS_MONTH_LABELS[i],
                'original_forecast': originals[i],
                'smoothed_target': per_month_smoothed[i],
                'actual': actual,
                'status': status,
                'adjusted_target': None,
                'variance': None
            })

        remaining_need = bts_total - final_actual_sum
        months_left = len(BTS_MONTH_KEYS) - final_months_count

        for md in months_data:
            if md['status'] == 'final' and md['actual'] is not None:
                md['variance'] = md['actual'] - md['smoothed_target']
                md['adjusted_target'] = md['smoothed_target']
            elif md['status'] == 'in_progress' and md['actual'] is not None:
                md['variance'] = md['actual'] - md['smoothed_target']
                if months_left > 0:
                    md['adjusted_target'] = round(remaining_need / months_left, 1)
                else:
                    md['adjusted_target'] = md['smoothed_target']
            else:
                if months_left > 0:
                    md['adjusted_target'] = round(remaining_need / months_left, 1)
                else:
                    md['adjusted_target'] = 0

        total_actual = final_actual_sum
        for md in months_data:
            if md['status'] == 'in_progress' and md['actual'] is not None:
                total_actual += md['actual']

        mar_actual = row.get('Mar_Actual')
        mar_forecast = row.get('Mar_Forecast')
        mar_baseline = {
            'actual': int(mar_actual) if pd.notna(mar_actual) else None,
            'forecast': int(mar_forecast) if pd.notna(mar_forecast) else None,
            'variance': int(mar_actual - mar_forecast) if (pd.notna(mar_actual) and pd.notna(mar_forecast)) else None
        }

        tracker_subjects.append({
            'subject': subject,
            'run_rate': float(row.get('Run_Rate', 0)),
            'bts_total': bts_total,
            'smoothed_target': float(smoothed),
            'actual_to_date': total_actual,
            'remaining_need': remaining_need,
            'months_completed': final_months_count,
            'problem_type': row.get('Problem_Type', 'On Track'),
            'category': row.get('Category', 'Other'),
            'march_baseline': mar_baseline,
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
            'uploaded_at': datetime.fromtimestamp(mtime, tz=CST).strftime('%Y-%m-%d %I:%M %p CST'),
            'subjects_count': len(df)
        })

    for filepath in sorted(glob.glob(os.path.join(forecasts_dir, '*.xlsx'))):
        filename = os.path.basename(filepath)
        mtime = os.path.getmtime(filepath)
        uploads.append({
            'type': 'forecast',
            'month': None,
            'filename': filename,
            'uploaded_at': datetime.fromtimestamp(mtime, tz=CST).strftime('%Y-%m-%d %I:%M %p CST'),
            'subjects_count': None
        })

    return uploads


def generate_dashboard_data(df_final, tracker_subjects, history, uploads):
    """Generate JSON data for dashboard including monthly tracker."""

    supply_mask = df_final['Problem_Type'].isin(['True Supply Problem', 'Supply Problem (No Util Data)'])
    summary = {
        'total_subjects': len(df_final),
        'utilization_problems': len(df_final[df_final['Problem_Type'] == 'Possible Placement Issue']),
        'supply_problems': int(supply_mask.sum()),
        'on_track': len(df_final[df_final['Problem_Type'].str.contains('On Track')]),
        'last_updated': datetime.now(tz=CST).strftime('%Y-%m-%d %I:%M %p CST')
    }

    portfolio_bts_total = sum(ts['bts_total'] for ts in tracker_subjects)
    portfolio_actual = sum(ts['actual_to_date'] for ts in tracker_subjects)
    months_with_data = max((ts['months_completed'] for ts in tracker_subjects), default=0)

    summary['portfolio_bts_total'] = round(portfolio_bts_total, 0)
    summary['portfolio_actual_to_date'] = round(portfolio_actual, 0)
    summary['portfolio_remaining'] = round(portfolio_bts_total - portfolio_actual, 0)
    summary['months_completed'] = months_with_data
    summary['months_remaining'] = len(BTS_MONTH_KEYS) - months_with_data

    mar_matched = [ts for ts in tracker_subjects
                    if ts['march_baseline']['actual'] is not None
                    and ts['march_baseline']['forecast'] is not None]
    mar_total_actual = sum(ts['march_baseline']['actual'] for ts in mar_matched)
    mar_total_forecast = sum(ts['march_baseline']['forecast'] for ts in mar_matched)
    summary['march_baseline'] = {
        'total_actual': mar_total_actual,
        'total_forecast': mar_total_forecast,
        'variance': mar_total_actual - mar_total_forecast if mar_total_forecast else None,
        'subjects_with_data': len(mar_matched)
    }

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


def validate_data(df_runrate, df_forecast, df_utilization):
    """Validate loaded data for common issues."""
    warnings = []

    neg_rr = df_runrate[df_runrate['Run_Rate'] < 0]
    if len(neg_rr) > 0:
        warnings.append(f"  {len(neg_rr)} subjects have negative run rates")

    if len(df_runrate) == 0:
        warnings.append("  Run rates file produced zero subjects")

    if len(df_forecast) == 0:
        warnings.append("  Forecast file produced zero subjects")

    if len(df_utilization) > 0:
        out_of_range = df_utilization[
            (df_utilization['Util_Rate'] < 0) | (df_utilization['Util_Rate'] > 100)
        ]
        if len(out_of_range) > 0:
            warnings.append(f"  {len(out_of_range)} subjects have utilization outside 0-100%")

    for w in warnings:
        print(f"WARNING: {w}")

    return warnings


def main():
    print("Starting BTS Forecast Analysis...")

    run_rate_path = 'data/run_rates.csv'
    forecast_path = 'data/monitoring_table.xlsx'
    utilization_path = 'data/utilization.csv'
    actuals_dir = 'data/actuals'
    forecasts_dir = 'data/forecasts'

    adjustments_dir = 'data/adjustments'

    os.makedirs(actuals_dir, exist_ok=True)
    os.makedirs(forecasts_dir, exist_ok=True)
    os.makedirs(adjustments_dir, exist_ok=True)

    march_finals_path = 'data/march_finals.csv'

    for required in [run_rate_path, forecast_path, utilization_path]:
        if not os.path.exists(required):
            print(f"ERROR: Required file not found: {required}")
            sys.exit(1)

    try:
        print("Loading data...")
        df_runrate, df_forecast, df_utilization = load_and_clean_data(
            run_rate_path, forecast_path, utilization_path
        )
    except Exception as e:
        print(f"ERROR: Failed to load input data: {e}")
        sys.exit(1)

    validate_data(df_runrate, df_forecast, df_utilization)

    march_overrides = None
    if os.path.exists(march_finals_path):
        try:
            print("Loading March finals override...")
            df_march = pd.read_csv(march_finals_path, skiprows=1)
            df_march.columns = ['Subject_ID', 'Subject', 'Mar_Forecast_Final', 'Mar_Actual_Final']
            df_march['Subject'] = df_march['Subject'].astype(str).str.strip()
            df_march['Mar_Forecast_Final'] = pd.to_numeric(df_march['Mar_Forecast_Final'], errors='coerce')
            df_march['Mar_Actual_Final'] = pd.to_numeric(df_march['Mar_Actual_Final'], errors='coerce')
            march_overrides = {}
            for _, row in df_march.iterrows():
                if pd.notna(row['Subject']) and row['Subject']:
                    march_overrides[row['Subject']] = {
                        'forecast': float(row['Mar_Forecast_Final']) if pd.notna(row['Mar_Forecast_Final']) else None,
                        'actual': float(row['Mar_Actual_Final']) if pd.notna(row['Mar_Actual_Final']) else None
                    }
            print(f"  Loaded March finals for {len(march_overrides)} subjects")
        except Exception as e:
            print(f"WARNING: Could not load March finals ({e}), continuing without them")

    print("Loading actuals...")
    actuals, month_statuses = load_actuals(actuals_dir)
    if actuals:
        print(f"  Found actuals for {len(actuals)} month(s): {', '.join(sorted(actuals.keys()))}")
    else:
        print("  No actuals uploaded yet")

    print("Loading manual adjustments...")
    manual_adjustments = load_manual_adjustments(adjustments_dir)
    if manual_adjustments:
        print(f"  {len(manual_adjustments)} month file(s) with manual overrides (applied before all calculations)")

    try:
        print("Calculating smoothed forecasts (with manual adjustments applied)...")
        df_analysis = calculate_smoothed_forecasts(df_forecast, df_runrate, manual_adjustments, march_overrides)

        print("Classifying problems...")
        df_final = classify_problems(df_analysis, df_utilization)

        print("Building monthly tracker...")
        tracker_subjects = calculate_monthly_tracker(df_final, actuals, month_statuses)

        print("Generating performance history...")
        history = generate_history(tracker_subjects, actuals)

        print("Building upload log...")
        uploads = build_upload_log(actuals_dir, forecasts_dir)

        print("Generating dashboard data...")
        dashboard_data = generate_dashboard_data(df_final, tracker_subjects, history, uploads)
    except Exception as e:
        print(f"ERROR: Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    df_final.to_csv('data/analysis_results.csv', index=False)

    with open('dashboard/data.json', 'w') as f:
        json.dump(dashboard_data, f, indent=2)

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
