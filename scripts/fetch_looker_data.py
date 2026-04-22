"""
Fetch data from Looker API
Pulls run rate, utilization, and actuals data for BTS forecast analysis.

Supports both Look IDs (stable, recommended) and raw query IDs.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from io import StringIO

import pandas as pd
import requests

BTS_MONTH_KEYS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

MAX_RETRIES = 3
BACKOFF_BASE = 2  # seconds; delays will be 2, 4, 8 …

RUN_RATE_SUBJECT_PATTERNS = ['subject name', 'subject']
RUN_RATE_VALUE_PATTERNS = ['attain', 'run rate', 'total count']
UTILIZATION_SUBJECT_PATTERNS = ['tutor start month', 'subject name', 'subject']
NAT_P90_SUBJECT_PATTERNS = ['subject name', 'subject']
NAT_P90_VALUE_PATTERNS   = ['p90', 'hours to assign']
UNIQUE_TUTORS_VALUE_PATTERNS = ['tutor count', 'count']
TUTOR_HOURS_SUBJECT_PATTERNS = ['subject name', 'subject']
TUTOR_HOURS_UTIL_PATTERNS = ['utilization', 'util', 'hours util']
TUTOR_HOURS_DEFAULTED_PATTERNS = ['default', 'null']


class LookerAPI:
    def __init__(self, base_url, client_id, client_secret):
        self.base_url = base_url.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.token = None

    def authenticate(self):
        """Get access token from Looker."""
        url = f"{self.base_url}/api/4.0/login"
        resp = self._request_with_retry(
            "POST",
            url,
            data={"client_id": self.client_id, "client_secret": self.client_secret},
            auth_call=True,
        )
        self.token = resp.json()["access_token"]
        print("✓ Authenticated with Looker API")

    def _request_with_retry(self, method, url, *, auth_call=False, **kwargs):
        """Issue an HTTP request with retry + exponential backoff."""
        if not auth_call and not self.token:
            self.authenticate()

        if not auth_call:
            kwargs.setdefault("headers", {})["Authorization"] = f"Bearer {self.token}"

        last_exc = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = requests.request(method, url, timeout=120, **kwargs)
                if resp.status_code == 200:
                    return resp
                # 429 / 5xx are retryable; others are not
                if resp.status_code not in (429, 500, 502, 503, 504):
                    raise LookerAPIError(
                        f"HTTP {resp.status_code}: {resp.text[:500]}"
                    )
                last_exc = LookerAPIError(
                    f"HTTP {resp.status_code} (attempt {attempt}/{MAX_RETRIES})"
                )
            except requests.RequestException as exc:
                last_exc = exc

            if attempt < MAX_RETRIES:
                delay = BACKOFF_BASE ** attempt
                print(f"  Retrying in {delay}s (attempt {attempt}/{MAX_RETRIES})…")
                time.sleep(delay)

        raise last_exc  # type: ignore[misc]

    def run_look(self, look_id, limit=10000):
        """Run a saved Look and return its results as a DataFrame."""
        url = f"{self.base_url}/api/4.0/looks/{look_id}/run/csv"
        resp = self._request_with_retry("GET", url, params={"limit": limit})
        return pd.read_csv(StringIO(resp.text))

    def run_query(self, query_id, limit=10000):
        """Run a raw query ID and return its results as a DataFrame."""
        url = f"{self.base_url}/api/4.0/queries/{query_id}/run/csv"
        resp = self._request_with_retry("GET", url, params={"limit": limit})
        return pd.read_csv(StringIO(resp.text))


class LookerAPIError(Exception):
    pass


def _find_column(df, patterns, label):
    """Find a column whose name contains one of the given patterns (case-insensitive)."""
    for pat in patterns:
        for col in df.columns:
            if pat in str(col).lower():
                return col
    print(f"  ⚠  {label}: could not find column matching {patterns}")
    print(f"     Columns received: {list(df.columns)}")
    return None


def _fetch(api, look_id, query_id, label):
    """Fetch data using a Look ID (preferred) or a raw query ID as fallback."""
    if look_id:
        print(f"  Using Look ID {look_id}")
        return api.run_look(look_id)
    if query_id:
        print(f"  Using Query ID {query_id}")
        return api.run_query(query_id)
    raise LookerAPIError(f"No Look ID or Query ID configured for {label}")


def fetch_run_rates(api, *, dry_run=False):
    """Fetch run rate data from Looker."""
    look_id = os.getenv("LOOKER_RUN_RATE_LOOK_ID", "").strip() or None
    query_id = os.getenv("LOOKER_RUN_RATE_QUERY_ID", "").strip() or None

    # Fall back to hardcoded placeholder for backward compat
    if not look_id and not query_id:
        print("⚠  No LOOKER_RUN_RATE_LOOK_ID or LOOKER_RUN_RATE_QUERY_ID set")
        print("   Skipping run rate fetch — using existing data/run_rates.csv if available")
        return False

    print("Fetching run rate data from Looker…")
    try:
        df = _fetch(api, look_id, query_id, "run rates")
        subj_col = _find_column(df, RUN_RATE_SUBJECT_PATTERNS, "run rates")
        rate_col = _find_column(df, RUN_RATE_VALUE_PATTERNS, "run rates")
        if subj_col and rate_col:
            df = df.rename(columns={subj_col: 'Subject Name - General', rate_col: 'Total Count Likely Attanable'})
            df = df[['Subject Name - General', 'Total Count Likely Attanable']]
            print(f"  Normalized columns: {subj_col!r} → Subject Name - General, {rate_col!r} → Total Count Likely Attanable")
        else:
            print(f"  ⚠  Could not auto-detect columns; saving raw Looker output")
        if dry_run:
            print(f"  [dry-run] Would save {len(df)} rows to data/run_rates.csv")
        else:
            df.to_csv("data/run_rates.csv", index=False)
            print(f"✓ Run rate data saved: {len(df)} subjects")
        return True
    except Exception as exc:
        print(f"⚠  Could not fetch run rates: {exc}")
        print("   Using existing data/run_rates.csv if available")
        return False


def fetch_utilization(api, *, dry_run=False):
    """Fetch utilization data from Looker."""
    look_id = os.getenv("LOOKER_UTILIZATION_LOOK_ID", "").strip() or None
    query_id = os.getenv("LOOKER_UTILIZATION_QUERY_ID", "").strip() or None

    if not look_id and not query_id:
        print("⚠  No LOOKER_UTILIZATION_LOOK_ID or LOOKER_UTILIZATION_QUERY_ID set")
        print("   Skipping utilization fetch — using existing data/utilization.csv if available")
        return False

    print("Fetching utilization data from Looker…")
    try:
        df = _fetch(api, look_id, query_id, "utilization")
        subj_col = _find_column(df, UTILIZATION_SUBJECT_PATTERNS, "utilization")
        if subj_col:
            df = df.rename(columns={subj_col: 'Subject'})
            print(f"  Normalized subject column: {subj_col!r} → Subject")
        if dry_run:
            print(f"  [dry-run] Would save {len(df)} rows to data/utilization.csv")
        else:
            df.to_csv("data/utilization.csv", index=False)
            print(f"✓ Utilization data saved: {len(df)} subjects")
        return True
    except Exception as exc:
        print(f"⚠  Could not fetch utilization: {exc}")
        print("   Using existing data/utilization.csv if available")
        return False


ACTUALS_MEASURE_MAP = {
    'tutor count': 'Actual_Contracted',
    'tutor tutor count': 'Actual_Contracted',
    'auto assignable': 'Auto_Assignable',
    'assignable in subject': 'Auto_Assignable',
    'opportunity responded': 'Opps_Responded',
    'responded total': 'Opps_Responded',
    'assignment count': 'Assigns',
    'total assignment': 'Assigns',
}


def _parse_pivoted_actuals(df):
    """Parse Looker's pivoted actuals export into a tall DataFrame.

    Looker pivots months into columns, producing a layout like:
      Row 0 (header):      PivotDimName | 2026-04 | 2026-04.1 | 2026-04.2 | ...
      Row 1 (sub-header):  SubjectLabel | Measure1| Measure2  | Measure3  | ...
      Row 2+:              SubjectName  |  value  |  value    |  value    | ...
    """
    import re

    raw_headers = list(df.columns)
    sub_header = df.iloc[0].tolist()
    data_rows = df.iloc[1:].reset_index(drop=True)

    print(f"  Pivot sub-header: {sub_header}")

    month_col_groups = {}
    for i, header in enumerate(raw_headers):
        if i == 0:
            continue
        month_key = _normalize_month(re.sub(r'\.\d+$', '', str(header)))
        if month_key not in month_col_groups:
            month_col_groups[month_key] = []
        measure_name = str(sub_header[i]).strip()
        month_col_groups[month_key].append((i, measure_name))

    print(f"  Detected months in pivot: {list(month_col_groups.keys())}")

    all_rows = []
    for _, data_row in data_rows.iterrows():
        subject = str(data_row.iloc[0]).strip()
        if not subject or subject.lower() in ('nan', ''):
            continue
        for month_key, col_pairs in month_col_groups.items():
            row = {'Subject': subject, 'Month_Key': month_key}
            for col_idx, measure_name in col_pairs:
                standard = _map_measure(measure_name)
                if standard:
                    val = pd.to_numeric(data_row.iloc[col_idx], errors='coerce')
                    row[standard] = int(val) if pd.notna(val) else 0
            all_rows.append(row)

    result = pd.DataFrame(all_rows)
    print(f"  Unpivoted to {len(result)} rows across {len(month_col_groups)} month(s)")
    return result


def _map_measure(name):
    """Map a Looker measure header to a standard column name."""
    lower = str(name).lower().strip()
    for pattern, standard in ACTUALS_MEASURE_MAP.items():
        if pattern in lower:
            return standard
    return None


def fetch_actuals(api, *, dry_run=False):
    """Fetch BTS actuals from Looker — split by month into data/actuals/."""
    look_id = os.getenv("LOOKER_ACTUALS_LOOK_ID", "").strip() or None
    query_id = os.getenv("LOOKER_ACTUALS_QUERY_ID", "").strip() or None

    if not look_id and not query_id:
        print("⚠  No LOOKER_ACTUALS_LOOK_ID or LOOKER_ACTUALS_QUERY_ID set")
        print("   Skipping actuals fetch — using existing data/actuals/ if available")
        return False

    print("Fetching BTS actuals from Looker…")
    try:
        df = _fetch(api, look_id, query_id, "actuals")
        print(f"  Raw columns: {list(df.columns)}")

        is_pivoted = any(
            _normalize_month(re.sub(r'\.\d+$', '', str(c))) in BTS_MONTH_KEYS
            for c in df.columns[1:]
        )

        if is_pivoted:
            print("  Detected pivoted Looker format — unpivoting…")
            df = _parse_pivoted_actuals(df)
        else:
            subj_col = _find_column(df, ['subject name', 'subject'], "actuals subject")
            month_col = _find_column(df, ['start month', 'month'], "actuals month")
            contracted_col = _find_column(df, ['tutor count', 'contracted'], "actuals contracted")
            if not subj_col or not month_col or not contracted_col:
                print("  ⚠  Could not identify required columns")
                if not dry_run:
                    os.makedirs('data', exist_ok=True)
                    df.to_csv('data/actuals_raw.csv', index=False)
                return False
            rename = {subj_col: 'Subject', month_col: 'Month', contracted_col: 'Actual_Contracted'}
            for col in df.columns:
                m = _map_measure(col)
                if m and m not in rename.values():
                    rename[col] = m
            df = df.rename(columns=rename)
            for c in ['Actual_Contracted', 'Auto_Assignable', 'Opps_Responded', 'Assigns']:
                if c in df.columns:
                    df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0).astype(int)
            df['Month_Key'] = df['Month'].astype(str).str.strip().apply(_normalize_month)

        if 'Actual_Contracted' not in df.columns:
            print("  ⚠  No Actual_Contracted column found after parsing")
            if not dry_run:
                os.makedirs('data', exist_ok=True)
                df.to_csv('data/actuals_raw.csv', index=False)
            return False

        now = datetime.now(timezone.utc)
        current_month_key = now.strftime('%Y-%m')
        extra_cols = [c for c in ['Auto_Assignable', 'Opps_Responded', 'Assigns'] if c in df.columns]
        statuses = {}
        months_written = 0

        if not dry_run:
            os.makedirs('data/actuals', exist_ok=True)

        for month_key in BTS_MONTH_KEYS:
            month_df = df[df['Month_Key'] == month_key]
            if month_df.empty:
                continue

            has_real_data = (month_df['Actual_Contracted'] > 0).any()
            if not has_real_data:
                print(f"  Skipping {month_key}: all zeros/null")
                continue

            out_cols = ['Subject', 'Actual_Contracted'] + [c for c in extra_cols if c in month_df.columns]
            out_df = month_df[out_cols].copy()
            out_df = out_df.sort_values('Subject').reset_index(drop=True)

            status = 'final' if month_key < current_month_key else 'in_progress'
            statuses[month_key] = status

            if dry_run:
                print(f"  [dry-run] {month_key}: {len(out_df)} subjects [{status}]")
            else:
                out_df.to_csv(f'data/actuals/{month_key}.csv', index=False)
                print(f"  ✓ {month_key}: {len(out_df)} subjects, "
                      f"{out_df['Actual_Contracted'].sum()} total contracted [{status}]")
            months_written += 1

        if not dry_run and statuses:
            with open('data/actuals/status.json', 'w') as f:
                json.dump(statuses, f, indent=2)

        print(f"✓ Actuals saved: {months_written} month(s)")
        return True
    except Exception as exc:
        print(f"⚠  Could not fetch actuals: {exc}")
        import traceback
        traceback.print_exc()
        print("   Using existing data/actuals/ if available")
        return False


def fetch_nat_p90(api, *, dry_run=False):
    """Fetch P90 time-on-NAT by subject from Looker Look 26319.

    Used to confirm Over-Supplied classification:
      P90 < 24h  → placements filling within operational goal → confirmed Over-Supplied
      P90 >= 24h → students waiting beyond goal → placement anomaly → reclassify as Under-Used

    The Look is pre-filtered in Looker to remove noise subjects (stale campaigns,
    legacy subject IDs) so no additional filtering is needed here.
    """
    look_id = os.getenv("LOOKER_NAT_P90_LOOK_ID", "26319").strip() or None

    if not look_id:
        print("⚠  No LOOKER_NAT_P90_LOOK_ID set — using default Look 26319")
        look_id = "26319"

    print("Fetching P90 NAT hours from Looker...")
    try:
        df = _fetch(api, look_id, None, "nat_p90")
        subj_col = _find_column(df, NAT_P90_SUBJECT_PATTERNS, "nat_p90 subject")
        p90_col  = _find_column(df, NAT_P90_VALUE_PATTERNS,   "nat_p90 value")

        if subj_col and p90_col:
            df = df.rename(columns={subj_col: 'Subject', p90_col: 'P90_NAT_Hours'})
            df = df[['Subject', 'P90_NAT_Hours']].copy()
            df['P90_NAT_Hours'] = pd.to_numeric(df['P90_NAT_Hours'], errors='coerce')
            print(f"  Normalized columns: {subj_col!r} → Subject, {p90_col!r} → P90_NAT_Hours")
        else:
            print("  ⚠  Could not auto-detect columns; saving raw output")

        if dry_run:
            print(f"  [dry-run] Would save {len(df)} rows to data/nat_p90.csv")
        else:
            os.makedirs('data', exist_ok=True)
            df.to_csv("data/nat_p90.csv", index=False)
            print(f"✓ P90 NAT data saved: {len(df)} subjects")
        return True
    except Exception as exc:
        print(f"⚠  Could not fetch NAT P90: {exc}")
        print("   Using existing data/nat_p90.csv if available")
        return False


def fetch_unique_tutors(api, *, dry_run=False):
    """Fetch unique tutor count for the current month from Looker Look 26320.

    The Look returns one row per day with columns for date and tutor count.
    We sum the count column to get total unique tutors for the month.
    """
    look_id = os.getenv("LOOKER_UNIQUE_TUTORS_LOOK_ID", "26320").strip() or None

    if not look_id:
        print("⚠  No LOOKER_UNIQUE_TUTORS_LOOK_ID set — using default Look 26320")
        look_id = "26320"

    print("Fetching unique tutor count from Looker...")
    try:
        df = _fetch(api, look_id, None, "unique_tutors")
        count_col = _find_column(df, UNIQUE_TUTORS_VALUE_PATTERNS, "unique_tutors count")

        if count_col:
            date_col = _find_column(df, ['date', 'start date', 'tutor start'], "unique_tutors date")
            if date_col:
                df = df[df[date_col].notna() & (df[date_col].astype(str).str.strip() != '')]
                print(f"  Filtered to {len(df)} rows with valid dates (excluded totals row)")
            total = pd.to_numeric(df[count_col], errors='coerce').sum()
            total = int(total) if pd.notna(total) else 0
            result_df = pd.DataFrame([{'Unique_Tutors': total}])
            print(f"  Summed {len(df)} daily rows from {count_col!r} → Unique_Tutors = {total}")
        else:
            result_df = df
            print("  ⚠  Could not auto-detect count column; saving raw output")

        if dry_run:
            print(f"  [dry-run] Would save unique tutor count to data/unique_tutors.csv")
        else:
            os.makedirs('data', exist_ok=True)
            result_df.to_csv("data/unique_tutors.csv", index=False)
            print(f"✓ Unique tutor count saved")
        return True
    except Exception as exc:
        print(f"⚠  Could not fetch unique tutors: {exc}")
        print("   Using existing data/unique_tutors.csv if available")
        return False


def fetch_tutor_hours_utilization(api, *, dry_run=False):
    """Fetch all-tutor hours utilization by subject from Looker.

    Measures actual hours worked / desired hours across ALL tutors (not just new
    ones). Above 100% means tutors working more than desired; below means idle
    capacity. Env var LOOKER_TUTOR_HOURS_UTIL_LOOK_ID required (no default).
    """
    look_id = (os.getenv("LOOKER_TUTOR_HOURS_UTIL_LOOK_ID") or "").strip() or None

    if not look_id:
        print("ℹ  LOOKER_TUTOR_HOURS_UTIL_LOOK_ID not set — skipping tutor hours util fetch")
        return True

    print("Fetching All Tutor Hours Utilization from Looker...")
    try:
        df = _fetch(api, look_id, None, "tutor_hours_util")
        subj_col = _find_column(df, TUTOR_HOURS_SUBJECT_PATTERNS, "tutor_hours_util subject")
        util_col = _find_column(df, TUTOR_HOURS_UTIL_PATTERNS, "tutor_hours_util value")

        keep_cols = {}
        if subj_col and util_col:
            df = df.rename(columns={subj_col: 'Subject', util_col: 'Tutor_Hours_Util_Pct'})
            df['Tutor_Hours_Util_Pct'] = pd.to_numeric(df['Tutor_Hours_Util_Pct'], errors='coerce')
            keep_cols['Subject'] = True
            keep_cols['Tutor_Hours_Util_Pct'] = True
            print(f"  Normalized columns: {subj_col!r} → Subject, {util_col!r} → Tutor_Hours_Util_Pct")

            defaulted_col = _find_column(df, TUTOR_HOURS_DEFAULTED_PATTERNS, "tutor_hours_util defaulted_pct")
            if defaulted_col:
                df = df.rename(columns={defaulted_col: 'Defaulted_Pct'})
                df['Defaulted_Pct'] = pd.to_numeric(df['Defaulted_Pct'], errors='coerce')
                keep_cols['Defaulted_Pct'] = True
                print(f"  Also captured: {defaulted_col!r} → Defaulted_Pct")
            else:
                print("  ⚠  No defaulted-hours column found — skipping Defaulted_Pct")

            df = df[list(keep_cols.keys())].copy()
        else:
            print("  ⚠  Could not auto-detect columns; saving raw output")

        if dry_run:
            print(f"  [dry-run] Would save {len(df)} rows to data/tutor_hours_util.csv")
        else:
            os.makedirs('data', exist_ok=True)
            df.to_csv("data/tutor_hours_util.csv", index=False)
            print(f"✓ Tutor hours utilization saved: {len(df)} subjects")
        return True
    except Exception as exc:
        print(f"⚠  Could not fetch tutor hours utilization: {exc}")
        print("   Using existing data/tutor_hours_util.csv if available")
        return False


def _normalize_month(val):
    """Convert month values like '2026-04', '2026-04-01', 'April 2026' to 'YYYY-MM'."""
    s = str(val).strip()
    m = re.match(r'^(\d{4})-(\d{2})', s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    month_names = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04',
        'may': '05', 'june': '06', 'july': '07', 'august': '08',
        'september': '09', 'october': '10', 'november': '11', 'december': '12'
    }
    for name, num in month_names.items():
        if name in s.lower():
            year_m = re.search(r'(\d{4})', s)
            if year_m:
                return f"{year_m.group(1)}-{num}"
    return s


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Fetch BTS data from Looker API")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Authenticate and fetch data but don't overwrite local CSV files",
    )
    return parser.parse_args(argv)


def _write_fetch_status(results, dry_run=False, skipped=False):
    """Write data/fetch_status.json so the dashboard can warn about stale data."""
    now = datetime.now(timezone.utc).isoformat()
    status = {
        'fetched_at': now,
        'dry_run': dry_run,
        'skipped': skipped,
        'sources': results,
        'any_failed': not all(results.values()),
    }

    if not skipped:
        succeeded = [k for k, v in results.items() if v]
        if succeeded:
            status['last_successful_fetch'] = now

    existing = {}
    if os.path.exists('data/fetch_status.json'):
        try:
            with open('data/fetch_status.json') as f:
                existing = json.load(f)
        except Exception:
            pass

    if 'last_successful_fetch' not in status and 'last_successful_fetch' in existing:
        status['last_successful_fetch'] = existing['last_successful_fetch']

    if not dry_run:
        os.makedirs('data', exist_ok=True)
        with open('data/fetch_status.json', 'w') as f:
            json.dump(status, f, indent=2)
        print(f"✓ Fetch status written to data/fetch_status.json")
    return status


def main(argv=None):
    args = parse_args(argv)

    print("=" * 80)
    print("LOOKER DATA FETCH")
    if args.dry_run:
        print("  (dry-run mode — no files will be written)")
    print("=" * 80)

    client_id = os.getenv("LOOKER_CLIENT_ID")
    client_secret = os.getenv("LOOKER_CLIENT_SECRET")
    api_url = os.getenv("LOOKER_BASE_URL") or os.getenv("LOOKER_API_URL", "https://varsitytutors.looker.com")

    if not client_id or not client_secret:
        print("⚠  Looker credentials not found in environment")
        print("   Set LOOKER_CLIENT_ID and LOOKER_CLIENT_SECRET, then re-run.")
        print("   Skipping API fetch — will use existing CSV files")
        _write_fetch_status(
            {'run_rates': False, 'utilization': False, 'actuals': False, 'nat_p90': False,
             'unique_tutors': False, 'tutor_hours_util': False},
            dry_run=args.dry_run, skipped=True
        )
        return

    api = LookerAPI(api_url, client_id, client_secret)

    if args.dry_run:
        api.authenticate()  # verify creds are valid

    rr_ok      = fetch_run_rates(api, dry_run=args.dry_run)
    util_ok    = fetch_utilization(api, dry_run=args.dry_run)
    actuals_ok = fetch_actuals(api, dry_run=args.dry_run)
    nat_ok     = fetch_nat_p90(api, dry_run=args.dry_run)
    ut_ok      = fetch_unique_tutors(api, dry_run=args.dry_run)
    thu_ok     = fetch_tutor_hours_utilization(api, dry_run=args.dry_run)

    _write_fetch_status(
        {'run_rates': rr_ok, 'utilization': util_ok,
         'actuals': actuals_ok, 'nat_p90': nat_ok, 'unique_tutors': ut_ok,
         'tutor_hours_util': thu_ok},
        dry_run=args.dry_run,
    )

    print("\n✓ Looker data fetch complete")
    print("\nNote: monitoring_table.xlsx (Pierre's forecast) should be uploaded manually")
    print("      to data/monitoring_table.xlsx before running analysis")


if __name__ == "__main__":
    main()
