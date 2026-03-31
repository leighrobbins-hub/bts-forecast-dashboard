"""
Fetch data from Looker API
Pulls run rate and utilization data for BTS forecast analysis
"""

import requests
import pandas as pd
import os
import json
from datetime import datetime

class LookerAPI:
    def __init__(self, base_url, client_id, client_secret):
        self.base_url = base_url.rstrip('/')
        self.client_id = client_id
        self.client_secret = client_secret
        self.token = None
    
    def authenticate(self):
        """Get access token from Looker"""
        auth_url = f"{self.base_url}/api/4.0/login"
        
        response = requests.post(
            auth_url,
            data={
                'client_id': self.client_id,
                'client_secret': self.client_secret
            }
        )
        
        if response.status_code == 200:
            self.token = response.json()['access_token']
            print("✓ Authenticated with Looker API")
        else:
            raise Exception(f"Authentication failed: {response.status_code} - {response.text}")
    
    def run_query(self, query_id, limit=10000):
        """Run a Looker query and return results"""
        if not self.token:
            self.authenticate()
        
        # Run query
        query_url = f"{self.base_url}/api/4.0/queries/{query_id}/run/csv"
        
        headers = {
            'Authorization': f'Bearer {self.token}'
        }
        
        params = {
            'limit': limit
        }
        
        response = requests.get(query_url, headers=headers, params=params)
        
        if response.status_code == 200:
            # Parse CSV response
            from io import StringIO
            df = pd.read_csv(StringIO(response.text))
            return df
        else:
            raise Exception(f"Query failed: {response.status_code} - {response.text}")

def fetch_run_rates(api):
    """
    Fetch run rate data from Looker
    
    Query should return: Subject, Monthly contracting data
    Update QUERY_ID with your actual Looker query ID
    """
    QUERY_ID = "YOUR_RUN_RATE_QUERY_ID"  # TODO: Update this
    
    print("Fetching run rate data from Looker...")
    
    try:
        df = api.run_query(QUERY_ID)
        df.to_csv('data/run_rates.csv', index=False)
        print(f"✓ Run rate data saved: {len(df)} subjects")
        return True
    except Exception as e:
        print(f"⚠️  Could not fetch run rates: {e}")
        print("   Using existing data/run_rates.csv if available")
        return False

def fetch_utilization(api):
    """
    Fetch utilization data from Looker
    
    Query should return: Subject, Contracted count, Utilized within 30d
    Update QUERY_ID with your actual Looker query ID
    """
    QUERY_ID = "YOUR_UTILIZATION_QUERY_ID"  # TODO: Update this
    
    print("Fetching utilization data from Looker...")
    
    try:
        df = api.run_query(QUERY_ID)
        df.to_csv('data/utilization.csv', index=False)
        print(f"✓ Utilization data saved: {len(df)} subjects")
        return True
    except Exception as e:
        print(f"⚠️  Could not fetch utilization: {e}")
        print("   Using existing data/utilization.csv if available")
        return False

def main():
    print("=" * 80)
    print("LOOKER DATA FETCH")
    print("=" * 80)
    
    # Get credentials from environment
    client_id = os.getenv('LOOKER_CLIENT_ID')
    client_secret = os.getenv('LOOKER_CLIENT_SECRET')
    api_url = os.getenv('LOOKER_API_URL', 'https://varsitytutors.looker.com')
    
    if not client_id or not client_secret:
        print("⚠️  Looker credentials not found in environment")
        print("   Skipping API fetch - will use existing CSV files")
        return
    
    # Initialize API
    api = LookerAPI(api_url, client_id, client_secret)
    
    # Fetch data
    fetch_run_rates(api)
    fetch_utilization(api)
    
    print("\n✓ Looker data fetch complete")
    print("\nNote: monitoring_table.xlsx (Pierre's forecast) should be uploaded manually")
    print("      to data/monitoring_table.xlsx before running analysis")

if __name__ == "__main__":
    main()
