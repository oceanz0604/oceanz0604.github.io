#!/usr/bin/env python3
"""
monthly_leaderboard.py

Robust monthly leaderboard generator for sessions stored under:
  /sessions-by-member

It supports both array and dict shapes from Firebase.

Outputs to:
  /leaderboards/monthly/YYYY-MM/{memberId}:
    - total_minutes (int)
    - username (string)
    - sessions_count (int)

Run daily (or hourly) to keep leaderboard fresh.
"""

import sys
import traceback
from datetime import datetime
from collections import defaultdict
import firebase_admin
from firebase_admin import credentials, db

# ---------- CONFIG ----------
FIREBASE_CRED_PATH = r"C:\Firebase\fbcreds.json"   # update
FIREBASE_DB_URL = "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app"
SESSIONS_BY_MEMBER_PATH = "sessions-by-member"
LEADERBOARD_ROOT = "leaderboards/monthly"
# ----------------------------

def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})

def parse_iso(dt_str):
    """Parse ISO timestamp robustly; return datetime or None."""
    if not dt_str:
        return None
    try:
        # handle strings that may end with Z
        s = dt_str.rstrip("Z")
        # Try fractional seconds first
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            # fallback: try trimming fractional part if weird
            if "." in s:
                base, frac = s.split(".", 1)
                # drop microseconds fractional part
                try:
                    return datetime.fromisoformat(base)
                except Exception:
                    return None
            return None
    except Exception:
        return None

def is_current_month(dt):
    if dt is None:
        return False
    now = datetime.now()
    return (dt.year == now.year and dt.month == now.month)

def extract_username_from_discountnote(note):
    """
    Often note = "Member: username" — extract username portion.
    If can't extract, return None.
    """
    if not note:
        return None
    if isinstance(note, str) and "Member:" in note:
        return note.split("Member:", 1)[1].strip()
    return None

def compute_session_minutes(session):
    """
    Compute duration in minutes for one session.
    Prefer USINGMIN if >0, else compute from STARTPOINT/ENDPOINT.
    Returns integer minutes (rounded).
    """
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

def fetch_sessions_by_member():
    """Fetch raw sessions-by-member from Firebase."""
    ref = db.reference(SESSIONS_BY_MEMBER_PATH)
    data = ref.get()
    return data

def normalize_sessions_structure(raw):
    """
    Normalize the two possible shapes:
      1) Array where index == memberid (index 0 often null)
      2) Dict keyed by member id

    Returns dict: { member_id_str: { sessionId: sessionObj, ... }, ... }
    """
    normalized = {}
    if raw is None:
        return normalized

    # If it's a list/array
    if isinstance(raw, list):
        for idx, item in enumerate(raw):
            if item is None:
                continue
            member_id = str(idx)
            if isinstance(item, dict):
                normalized[member_id] = item
    elif isinstance(raw, dict):
        # already keyed by member id
        for k, v in raw.items():
            # skip nulls
            if v is None:
                continue
            normalized[str(k)] = v
    else:
        # Unexpected shape
        raise ValueError("Unsupported sessions-by-member JSON structure.")
    return normalized

def generate_monthly_totals(normalized_sessions):
    """Return dict { memberid: {"total_minutes": int, "username": str, "sessions_count": int} }"""
    totals = {}

    now = datetime.now()
    # iterate members
    for member_id, sessions_map in normalized_sessions.items():
        try:
            # sessions_map is mapping of sessionId -> session object
            total_mins = 0
            count = 0
            username = None

            if not isinstance(sessions_map, dict):
                continue

            for sid, sess in sessions_map.items():
                # sess might be None
                if not isinstance(sess, dict):
                    continue

                # Determine if session belongs to current month
                # prefer STARTPOINT, fallback to 'start' or 'START'
                start_s = sess.get("STARTPOINT") or sess.get("start") or sess.get("Start")
                start_dt = parse_iso(start_s)
                if start_dt is None:
                    # if no start date, skip session for month counting
                    continue
                if start_dt.year != now.year or start_dt.month != now.month:
                    continue

                mins = compute_session_minutes(sess)
                total_mins += mins
                count += 1

                # attempt to get username from DISCOUNTNOTE (example: "Member: atodkar")
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
    """
    totals: dict of member_id -> {total_minutes, username, sessions_count}
    We'll write to LEADERBOARD_ROOT/month_key
    """
    ref = db.reference(f"{LEADERBOARD_ROOT}/{month_key}")
    # write the totals sorted (but we will store as mapping)
    ref.set(totals)
    print(f"✅ Leaderboard written to {LEADERBOARD_ROOT}/{month_key} (entries: {len(totals)})")

def run():
    try:
        init_firebase()
        raw = fetch_sessions_by_member()
        normalized = normalize_sessions_structure(raw)
        totals = generate_monthly_totals(normalized)

        # create month key "YYYY-MM"
        now = datetime.now()
        month_key = f"{now.year}-{now.month:02d}"

        # Optionally convert to top-n only before saving, but we'll save full totals.
        # If you want top-10 only:
        # sorted_items = sorted(totals.items(), key=lambda kv: kv[1]['total_minutes'], reverse=True)[:10]
        # top_totals = {k: v for k, v in sorted_items}
        # save_leaderboard_to_firebase(month_key, top_totals)

        # Save full totals (front-end can slice top 10)
        save_leaderboard_to_firebase(month_key, totals)

        # Print top 10 locally for logs
        sorted_list = sorted(totals.items(), key=lambda kv: kv[1]['total_minutes'], reverse=True)[:10]
        print("Top 10 this month:")
        for rank, (mid, info) in enumerate(sorted_list, start=1):
            print(f"{rank:2d}. {info['username']} (member {mid}) — {info['total_minutes']} min ({info['sessions_count']} sessions)")

    except Exception as e:
        print("Fatal error while generating leaderboard:")
        traceback.print_exc()
        sys.exit(2)

if __name__ == "__main__":
    run()
