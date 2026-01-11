"""
OceanZ Gaming Cafe - Monthly Leaderboard Generator (OPTIMIZED)

INCREMENTAL CALCULATION - Uses pre-aggregated daily data when possible.

Features:
- Uses daily-summary data for fast calculation
- Only recalculates if new data since last run
- Pre-computes weekly leaderboards too
- Caches results to avoid redundant computation

Run frequency: Every 30 minutes (Windows Task Scheduler)
"""

import sys
import os
import json
import traceback
from datetime import datetime, timedelta
from collections import defaultdict
import firebase_admin
from firebase_admin import credentials, db

# Import shared config
from config import (
    FIREBASE_CRED_PATH, FIREBASE_DB_URL, FB_PATHS
)

# ==================== LOCAL STATE ====================

LOCAL_STATE_FILE = os.path.join(os.path.dirname(__file__), ".leaderboard_state.json")

def load_local_state():
    """Load state from local file."""
    try:
        if os.path.exists(LOCAL_STATE_FILE):
            with open(LOCAL_STATE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {"last_sync": None, "last_history_id": 0}


def save_local_state(state):
    """Save state to local file."""
    try:
        with open(LOCAL_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"⚠️ Could not save state: {e}")


# ==================== FIREBASE ====================

def init_firebase():
    """Initialize Firebase connection."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


def check_if_update_needed(state):
    """Check if we need to recalculate leaderboards."""
    try:
        # Check sync-meta for latest history ID
        sync_meta = db.reference(FB_PATHS.SYNC_META).get() or {}
        current_history_id = sync_meta.get("last_history_id", 0)
        last_processed_id = state.get("last_history_id", 0)
        
        if current_history_id > last_processed_id:
            print(f"📊 New data detected (ID: {last_processed_id} → {current_history_id})")
            return True, current_history_id
        else:
            print(f"   No new data since last run")
            return False, current_history_id
            
    except Exception:
        # If can't check, assume update needed
        return True, 0


# ==================== DATA FETCHING ====================

def fetch_members():
    """Fetch members for username/stats lookup."""
    try:
        ref = db.reference(FB_PATHS.LEGACY_MEMBERS)
        data = ref.get()
        if isinstance(data, list):
            return [m for m in data if m]
        elif isinstance(data, dict):
            return list(data.values())
        return []
    except Exception as e:
        print(f"⚠️ Error fetching members: {e}")
        return []


def fetch_history_for_period(start_date, end_date=None):
    """
    Fetch history for a date range.
    Uses history-by-date if available, falls back to full history scan.
    """
    results = defaultdict(lambda: {"minutes": 0, "sessions": 0, "spent": 0})
    
    try:
        # Try using history-by-date (faster)
        history_by_date_ref = db.reference(FB_PATHS.HISTORY_BY_DATE)
        
        current = start_date
        end = end_date or datetime.now()
        
        while current <= end:
            date_str = current.strftime("%Y-%m-%d")
            day_data = history_by_date_ref.child(date_str).get()
            
            if day_data:
                for record_id, record in day_data.items():
                    username = record.get("username", "").upper()
                    if username:
                        results[username]["sessions"] += 1
                        results[username]["minutes"] += record.get("minutes", 0)
                        charge = record.get("charge", 0)
                        if charge < 0:
                            results[username]["spent"] += abs(charge)
            
            current += timedelta(days=1)
        
        if results:
            return dict(results)
            
    except Exception as e:
        print(f"⚠️ history-by-date not available: {e}")
    
    # Fallback: scan full history
    print("   Using full history scan (slower)...")
    return fetch_history_full_scan(start_date, end_date)


def fetch_history_full_scan(start_date, end_date=None):
    """Full history scan - fallback method."""
    results = defaultdict(lambda: {"minutes": 0, "sessions": 0, "spent": 0})
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = (end_date or datetime.now()).strftime("%Y-%m-%d")
    
    try:
        history_ref = db.reference(FB_PATHS.HISTORY)
        all_history = history_ref.get() or {}
        
        for username, records in all_history.items():
            if not isinstance(records, dict):
                continue
            
            for record_id, record in records.items():
                if not isinstance(record, dict):
                    continue
                
                record_date = record.get("DATE", "")
                if not record_date:
                    continue
                
                if start_str <= record_date <= end_str:
                    results[username]["sessions"] += 1
                    results[username]["minutes"] += float(record.get("USINGMIN") or 0)
                    
                    charge = float(record.get("CHARGE") or 0)
                    if charge < 0:
                        results[username]["spent"] += abs(charge)
        
        return dict(results)
        
    except Exception as e:
        print(f"❌ Error scanning history: {e}")
        return {}


# ==================== LEADERBOARD GENERATION ====================

def generate_monthly_leaderboard(members):
    """Generate current month's leaderboard."""
    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)
    month_key = f"{now.year}-{now.month:02d}"
    
    print(f"\n📊 Generating monthly leaderboard for {month_key}...")
    
    # Get activity data for this month
    activity = fetch_history_for_period(month_start)
    
    # Build member ID lookup
    id_to_username = {}
    username_to_id = {}
    for m in members:
        if m.get("ID") and m.get("USERNAME"):
            mid = str(m["ID"])
            uname = m["USERNAME"].upper()
            id_to_username[mid] = uname
            username_to_id[uname] = mid
    
    # Build leaderboard
    leaderboard = {}
    
    for username, stats in activity.items():
        if stats["minutes"] > 0:
            member_id = username_to_id.get(username, username)
            leaderboard[member_id] = {
                "username": username,
                "total_minutes": int(stats["minutes"]),
                "sessions_count": int(stats["sessions"]),
                "total_spent": round(stats["spent"], 2),
                "member_id": member_id
            }
    
    # Upload
    if leaderboard:
        db.reference(f"{FB_PATHS.LEADERBOARDS}/monthly/{month_key}").set(leaderboard)
        print(f"   ✅ Uploaded monthly leaderboard ({len(leaderboard)} entries)")
    else:
        print(f"   ⚠️ No activity data for {month_key}")
    
    return leaderboard


def generate_weekly_leaderboard(members):
    """Generate current week's leaderboard."""
    now = datetime.now()
    
    # Calculate week start (Monday)
    day_of_week = now.weekday()
    week_start = now - timedelta(days=day_of_week)
    week_start = datetime(week_start.year, week_start.month, week_start.day)
    
    # ISO week number
    week_num = now.isocalendar()[1]
    week_key = f"{now.year}-W{week_num:02d}"
    
    print(f"\n📊 Generating weekly leaderboard for {week_key}...")
    
    # Get activity data for this week
    activity = fetch_history_for_period(week_start)
    
    # Build leaderboard
    leaderboard = {}
    
    for username, stats in activity.items():
        if stats["minutes"] > 0:
            leaderboard[username] = {
                "username": username,
                "total_minutes": int(stats["minutes"]),
                "sessions_count": int(stats["sessions"]),
                "total_hours": round(stats["minutes"] / 60, 1)
            }
    
    # Upload
    if leaderboard:
        db.reference(f"{FB_PATHS.LEADERBOARDS}/weekly/{week_key}").set(leaderboard)
        print(f"   ✅ Uploaded weekly leaderboard ({len(leaderboard)} entries)")
    
    return leaderboard


def generate_alltime_leaderboard(members):
    """Generate all-time leaderboard from member stats."""
    print(f"\n📊 Generating all-time leaderboard...")
    
    # Sort by TOTALACTMINUTE
    sorted_members = sorted(
        [m for m in members if m.get("TOTALACTMINUTE", 0) > 0],
        key=lambda m: m.get("TOTALACTMINUTE", 0),
        reverse=True
    )[:50]  # Top 50
    
    leaderboard = []
    
    for i, m in enumerate(sorted_members):
        leaderboard.append({
            "rank": i + 1,
            "username": m.get("USERNAME", ""),
            "total_minutes": int(m.get("TOTALACTMINUTE", 0)),
            "total_hours": round(m.get("TOTALACTMINUTE", 0) / 60, 1),
            "total_paid": round(m.get("TOTALPAID", 0), 2),
            "member_since": m.get("RECDATE"),
            "member_id": m.get("ID")
        })
    
    # Upload
    if leaderboard:
        db.reference(f"{FB_PATHS.LEADERBOARDS}/all-time").set(leaderboard)
        print(f"   ✅ Uploaded all-time leaderboard ({len(leaderboard)} entries)")
    
    return leaderboard


# ==================== MAIN ====================

def run():
    """Main leaderboard generation routine."""
    start_time = datetime.now()
    
    print("\n" + "="*50)
    print("🏆 OceanZ Leaderboard Generator")
    print(f"   {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*50)
    
    try:
        init_firebase()
        state = load_local_state()
        
        # Check if update needed
        needs_update, current_history_id = check_if_update_needed(state)
        
        if not needs_update:
            # Still update all-time since it uses MEMBERS table directly
            members = fetch_members()
            if members:
                generate_alltime_leaderboard(members)
            
            elapsed = (datetime.now() - start_time).total_seconds()
            print(f"\n✅ Quick check completed in {elapsed:.1f}s")
            return
        
        # Fetch members
        members = fetch_members()
        print(f"📊 Loaded {len(members)} members")
        
        # Generate all leaderboards
        generate_alltime_leaderboard(members)
        generate_monthly_leaderboard(members)
        generate_weekly_leaderboard(members)
        
        # Update state
        state["last_sync"] = start_time.isoformat()
        state["last_history_id"] = current_history_id
        save_local_state(state)
        
        # Update sync meta
        db.reference(f"{FB_PATHS.SYNC_META}/leaderboard").update({
            "last_sync": start_time.isoformat(),
            "status": "ok"
        })
        
        elapsed = (datetime.now() - start_time).total_seconds()
        print("\n" + "="*50)
        print(f"✅ Leaderboards updated in {elapsed:.1f}s")
        print("="*50 + "\n")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    run()
