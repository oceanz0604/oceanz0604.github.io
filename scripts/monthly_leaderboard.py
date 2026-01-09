"""
OceanZ Gaming Cafe - Monthly Leaderboard Generator

Generates monthly playtime leaderboards from session data.
Run daily (or hourly) to keep leaderboard fresh.

Output path: /leaderboards/monthly/YYYY-MM/
"""

import sys
import traceback
from datetime import datetime
from collections import defaultdict
import firebase_admin
from firebase_admin import credentials, db

# ==================== CONFIGURATION ====================

FIREBASE_CRED_PATH = r"C:\Firebase\fbcreds.json"
FIREBASE_DB_URL = "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app"
SESSIONS_BY_MEMBER_PATH = "sessions-by-member"
LEADERBOARD_ROOT = "leaderboards/monthly"

# ==================== UTILITIES ====================

def init_firebase():
    """Initialize Firebase connection."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


def parse_iso(dt_str):
    """Parse ISO timestamp robustly."""
    if not dt_str:
        return None
    try:
        s = dt_str.rstrip("Z")
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            if "." in s:
                base, _ = s.split(".", 1)
                try:
                    return datetime.fromisoformat(base)
                except Exception:
                    return None
            return None
    except Exception:
        return None


def extract_username_from_discountnote(note):
    """Extract username from discount note field."""
    if not note or not isinstance(note, str):
        return None
    if "Member:" in note:
        return note.split("Member:", 1)[1].strip()
    return None


def compute_session_minutes(session):
    """Compute duration in minutes for one session."""
    try:
        usingmin = session.get("USINGMIN")
        if usingmin is not None:
            try:
                um = float(usingmin)
                if um > 0:
                    return int(round(um))
            except Exception:
                pass

        start_s = session.get("STARTPOINT") or session.get("start") or session.get("Start")
        end_s = session.get("ENDPOINT") or session.get("end") or session.get("End")

        start_dt = parse_iso(start_s)
        end_dt = parse_iso(end_s)
        
        if start_dt and end_dt:
            delta = end_dt - start_dt
            minutes = delta.total_seconds() / 60.0
            return int(round(max(0, minutes)))
    except Exception:
        pass
    return 0

# ==================== DATA PROCESSING ====================

def fetch_sessions_by_member():
    """Fetch raw sessions-by-member from Firebase."""
    ref = db.reference(SESSIONS_BY_MEMBER_PATH)
    return ref.get()


def normalize_sessions_structure(raw):
    """Normalize sessions data to consistent format."""
    normalized = {}
    if raw is None:
        return normalized

    if isinstance(raw, list):
        for idx, item in enumerate(raw):
            if item is None:
                continue
            member_id = str(idx)
            if isinstance(item, dict):
                normalized[member_id] = item
    elif isinstance(raw, dict):
        for k, v in raw.items():
            if v is None:
                continue
            normalized[str(k)] = v
    else:
        raise ValueError("Unsupported sessions-by-member JSON structure.")
    
    return normalized


def generate_monthly_totals(normalized_sessions):
    """Generate monthly totals for each member."""
    totals = {}
    now = datetime.now()

    for member_id, sessions_map in normalized_sessions.items():
        try:
            total_mins = 0
            count = 0
            username = None

            if not isinstance(sessions_map, dict):
                continue

            for sid, sess in sessions_map.items():
                if not isinstance(sess, dict):
                    continue

                start_s = sess.get("STARTPOINT") or sess.get("start") or sess.get("Start")
                start_dt = parse_iso(start_s)
                
                if start_dt is None:
                    continue
                if start_dt.year != now.year or start_dt.month != now.month:
                    continue

                mins = compute_session_minutes(sess)
                total_mins += mins
                count += 1

                if username is None:
                    note = sess.get("DISCOUNTNOTE") or sess.get("discountnote") or sess.get("DiscountNote")
                    uname = extract_username_from_discountnote(note)
                    if uname:
                        username = uname

            if total_mins > 0:
                if username is None:
                    username = f"member_{member_id}"
                totals[member_id] = {
                    "total_minutes": int(total_mins),
                    "username": username,
                    "sessions_count": int(count)
                }
        except Exception:
            print(f"⚠️ Error processing member {member_id}:")
            traceback.print_exc()
            continue

    return totals


def save_leaderboard_to_firebase(month_key, totals):
    """Save leaderboard to Firebase."""
    ref = db.reference(f"{LEADERBOARD_ROOT}/{month_key}")
    ref.set(totals)
    print(f"✅ Leaderboard written to {LEADERBOARD_ROOT}/{month_key} (entries: {len(totals)})")

# ==================== MAIN ====================

def run():
    try:
        init_firebase()
        raw = fetch_sessions_by_member()
        normalized = normalize_sessions_structure(raw)
        totals = generate_monthly_totals(normalized)

        now = datetime.now()
        month_key = f"{now.year}-{now.month:02d}"

        save_leaderboard_to_firebase(month_key, totals)

        # Print top 10 for logs
        sorted_list = sorted(totals.items(), key=lambda kv: kv[1]['total_minutes'], reverse=True)[:10]
        print("\n🏆 Top 10 this month:")
        for rank, (mid, info) in enumerate(sorted_list, start=1):
            print(f"  {rank:2d}. {info['username']} (member {mid}) — {info['total_minutes']} min ({info['sessions_count']} sessions)")

    except Exception as e:
        print("❌ Fatal error while generating leaderboard:")
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    run()

