"""
Fetch data from Looker API
Pulls run rate and utilization data for BTS forecast analysis.

Supports both Look IDs (stable, recommended) and raw query IDs.
"""

import argparse
import os
import sys
import time
from io import StringIO

import pandas as pd
import requests

MAX_RETRIES = 3
BACKOFF_BASE = 2  # seconds; delays will be 2, 4, 8 …

RUN_RATE_EXPECTED_COLUMNS = {"Subject"}
UTILIZATION_EXPECTED_COLUMNS = {"Subject"}


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


def _validate_columns(df, expected, label):
    """Warn if any expected columns are missing from the fetched data."""
    missing = expected - set(df.columns)
    if missing:
        print(f"  ⚠  {label}: missing expected columns {missing}")
        print(f"     Columns received: {list(df.columns)}")
        return False
    return True


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
        _validate_columns(df, RUN_RATE_EXPECTED_COLUMNS, "run rates")
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
        _validate_columns(df, UTILIZATION_EXPECTED_COLUMNS, "utilization")
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


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Fetch BTS data from Looker API")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Authenticate and fetch data but don't overwrite local CSV files",
    )
    return parser.parse_args(argv)


def _write_fetch_status(results, dry_run=False):
    """Write data/fetch_status.json so the dashboard can warn about stale data."""
    import json
    from datetime import datetime, timezone

    status = {
        'fetched_at': datetime.now(timezone.utc).isoformat(),
        'dry_run': dry_run,
        'sources': results,
        'any_failed': not all(results.values()),
    }
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
        _write_fetch_status({'run_rates': False, 'utilization': False}, dry_run=args.dry_run)
        return

    api = LookerAPI(api_url, client_id, client_secret)

    if args.dry_run:
        api.authenticate()  # verify creds are valid

    rr_ok = fetch_run_rates(api, dry_run=args.dry_run)
    util_ok = fetch_utilization(api, dry_run=args.dry_run)

    _write_fetch_status({'run_rates': rr_ok, 'utilization': util_ok}, dry_run=args.dry_run)

    print("\n✓ Looker data fetch complete")
    print("\nNote: monitoring_table.xlsx (Pierre's forecast) should be uploaded manually")
    print("      to data/monitoring_table.xlsx before running analysis")


if __name__ == "__main__":
    main()
