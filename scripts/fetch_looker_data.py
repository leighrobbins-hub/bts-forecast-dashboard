"""
Fetch data from Looker API
Pulls run rate, utilization, and actuals data for BTS forecast analysis.

Supports both Look IDs (stable, recommended) and raw query IDs.
"""

import argparse
import json
import os
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


ACTUALS_SUBJECT_PATTERNS = ['subject name', 'subject']
ACTUALS_MONTH_PATTERNS = ['start month', 'month']
ACTUALS_CONTRACTED_PATTERNS = ['tutor count', 'contracted', 'count']
ACTUALS_ASSIGNABLE_PATTERNS = ['auto assignable', 'assignable']
ACTUALS_RESPONDED_PATTERNS = ['responded', 'opportunity responded']
ACTUALS_ASSIGNS_PATTERNS = ['assignment count', 'assigns']


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

        subj_col = _find_column(df, ACTUALS_SUBJECT_PATTERNS, "actuals subject")
        month_col = _find_column(df, ACTUALS_MONTH_PATTERNS, "actuals month")
        contracted_col = _find_column(df, ACTUALS_CONTRACTED_PATTERNS, "actuals contracted")
        assignable_col = _find_column(df, ACTUALS_ASSIGNABLE_PATTERNS, "actuals assignable")
        responded_col = _find_column(df, ACTUALS_RESPONDED_PATTERNS, "actuals responded")
        assigns_col = _find_column(df, ACTUALS_ASSIGNS_PATTERNS, "actuals assigns")

        if not subj_col or not month_col or not contracted_col:
            print("  ⚠  Could not identify required columns (subject, month, contracted)")
            print("     Saving raw output to data/actuals_raw.csv for inspection")
            if not dry_run:
                os.makedirs('data', exist_ok=True)
                df.to_csv('data/actuals_raw.csv', index=False)
            return False

        rename_map = {subj_col: 'Subject', month_col: 'Month', contracted_col: 'Actual_Contracted'}
        extra_cols = []
        if assignable_col:
            rename_map[assignable_col] = 'Auto_Assignable'
            extra_cols.append('Auto_Assignable')
        if responded_col:
            rename_map[responded_col] = 'Opps_Responded'
            extra_cols.append('Opps_Responded')
        if assigns_col:
            rename_map[assigns_col] = 'Assigns'
            extra_cols.append('Assigns')

        df = df.rename(columns=rename_map)
        keep_cols = ['Subject', 'Month', 'Actual_Contracted'] + extra_cols
        df = df[[c for c in keep_cols if c in df.columns]]
        df['Actual_Contracted'] = pd.to_numeric(df['Actual_Contracted'], errors='coerce').fillna(0).astype(int)
        for ec in extra_cols:
            if ec in df.columns:
                df[ec] = pd.to_numeric(df[ec], errors='coerce').fillna(0).astype(int)

        month_raw = df['Month'].astype(str).str.strip()
        df['Month_Key'] = month_raw.apply(_normalize_month)

        now = datetime.now(timezone.utc)
        current_month_key = now.strftime('%Y-%m')
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


def _normalize_month(val):
    """Convert month values like '2026-04', '2026-04-01', 'April 2026' to 'YYYY-MM'."""
    import re
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
        _write_fetch_status({'run_rates': False, 'utilization': False}, dry_run=args.dry_run, skipped=True)
        return

    api = LookerAPI(api_url, client_id, client_secret)

    if args.dry_run:
        api.authenticate()  # verify creds are valid

    rr_ok = fetch_run_rates(api, dry_run=args.dry_run)
    util_ok = fetch_utilization(api, dry_run=args.dry_run)
    actuals_ok = fetch_actuals(api, dry_run=args.dry_run)

    _write_fetch_status(
        {'run_rates': rr_ok, 'utilization': util_ok, 'actuals': actuals_ok},
        dry_run=args.dry_run,
    )

    print("\n✓ Looker data fetch complete")
    print("\nNote: monitoring_table.xlsx (Pierre's forecast) should be uploaded manually")
    print("      to data/monitoring_table.xlsx before running analysis")


if __name__ == "__main__":
    main()
