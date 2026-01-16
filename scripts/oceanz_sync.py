#!/usr/bin/env python3
"""
OceanZ Gaming Cafe - Complete Unified Sync Script

This single script handles ALL sync operations:
1. FDB Database Sync (Members, History, Sessions, Guest Sessions)
2. Terminal Status Sync (from FDB TERMINALS table - real-time)
3. Cash Register Sync (Revenue from FDB KASAHAR table)
4. Leaderboard Calculation (from Firebase data)

No dependencies on other scripts - everything is inline.
"""

import os
import re
import sys
import shutil
import fdb
import json
import hashlib
import firebase_admin
from datetime import datetime, date, time, timedelta
from collections import defaultdict
from firebase_admin import credentials, db

# Import shared config
from config import (
    SOURCE_FDB_PATH, WORKING_FDB_PATH, FIREBASE_CRED_PATH, FIREBASE_DB_URL,
    FB_PATHS, FIREBIRD_USER, FIREBIRD_PASSWORD,
    ALL_TERMINALS, SESSION_RETENTION_DAYS,
    normalize_terminal_name, get_short_terminal_name
)

# Messages.msg file path (same folder as usdb.dat)
MESSAGES_FILE = os.path.join(os.path.dirname(SOURCE_FDB_PATH), "messages.msg")

# Local state files
LOCAL_SYNC_FILE = os.path.join(os.path.dirname(__file__), ".sync_state.json")

# ==================== UTILITIES ====================

def convert_value(val):
    """Convert Python values to Firebase-compatible format."""
    if val is None:
        return None
    if isinstance(val, (date, datetime)):
        return val.isoformat()
    if isinstance(val, time):
        return val.isoformat()
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="ignore")
    return val


def get_record_hash(record):
    """Generate hash of record for change detection."""
    serialized = json.dumps(record, sort_keys=True, default=str)
    return hashlib.md5(serialized.encode()).hexdigest()[:8]


def remove_none_values(data):
    """Recursively remove None values from dict/list. Firebase doesn't accept None."""
    if isinstance(data, dict):
        return {k: remove_none_values(v) for k, v in data.items() if v is not None}
    elif isinstance(data, list):
        return [remove_none_values(item) for item in data if item is not None]
    else:
        return data


# ==================== V2 OPTIMIZATION HELPERS ====================
# These functions compute data for the optimized single-key member structure

# Constants for v2 structure
RECENT_HISTORY_COUNT = 20   # Embed last 20 history entries in member profile
RECENT_SESSIONS_COUNT = 10  # Embed last 10 sessions in member profile


def calculate_streak(history_entries):
    """Calculate current activity streak in days from history entries."""
    if not history_entries:
        return 0
    
    dates = set()
    for entry in history_entries:
        d = entry.get("DATE")
        if d:
            dates.add(str(d).split("T")[0])
    
    if not dates:
        return 0
    
    sorted_dates = sorted(dates, reverse=True)
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    # Must have activity today or yesterday to have a streak
    if sorted_dates[0] != today and sorted_dates[0] != yesterday:
        return 0
    
    streak = 0
    check_date = datetime.strptime(sorted_dates[0], "%Y-%m-%d")
    
    for date_str in sorted_dates:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        diff = (check_date - d).days
        
        if diff == 0:
            streak += 1
            check_date = d - timedelta(days=1)
        elif diff == 1:
            streak += 1
            check_date = d - timedelta(days=1)
        else:
            break
    
    return streak


def get_activity_status(last_activity_date):
    """Determine activity status based on last activity date."""
    if not last_activity_date:
        return "ghost"
    
    try:
        last_date = datetime.strptime(str(last_activity_date).split("T")[0], "%Y-%m-%d")
        days_since = (datetime.now() - last_date).days
        
        if days_since <= 2:
            return "active"
        elif days_since <= 7:
            return "recent"
        elif days_since <= 30:
            return "inactive"
        else:
            return "ghost"
    except:
        return "unknown"


def compute_badges(member_data, history_entries, all_time_rank=None, total_spent=0, max_spent=0):
    """Compute badges for a member based on their activity."""
    badges = {}
    
    # Rank-based badges
    if all_time_rank == 1:
        badges["champion"] = True
    elif all_time_rank == 2:
        badges["runner_up"] = True
    elif all_time_rank == 3:
        badges["third_place"] = True
    
    # Activity badges
    total_minutes = member_data.get("TOTALACTMINUTE", 0)
    if total_minutes >= 10000:  # 166+ hours
        badges["grinder"] = True
    
    # Spending badge
    if max_spent > 0 and total_spent >= max_spent * 0.9:  # Top 10% spender
        badges["big_spender"] = True
    
    # Streak
    streak = calculate_streak(history_entries)
    if streak > 0:
        badges["streak_days"] = streak
    if streak >= 7:
        badges["streak_master"] = True
    
    # Ghost badge (inactive)
    last_activity = None
    if history_entries:
        sorted_entries = sorted(history_entries, key=lambda x: x.get("ID", 0), reverse=True)
        if sorted_entries:
            last_activity = sorted_entries[0].get("DATE")
    
    activity_status = get_activity_status(last_activity)
    if activity_status == "ghost":
        badges["ghost"] = True
    
    badges["activity_status"] = activity_status
    
    return badges


def build_optimized_member_data(member, history_entries, sessions, ranks):
    """
    Build the optimized v2 member data structure.
    
    Structure:
    {
        profile: { basic member info },
        balance: { current, total_loaded, total_spent },
        stats: { total_minutes, total_sessions, monthly_minutes, etc. },
        ranks: { all_time, monthly, weekly },
        badges: { champion, grinder, streak_days, etc. },
        recent_history: [ last 20 entries ],
        recent_sessions: [ last 10 sessions ]
    }
    """
    username = member.get("USERNAME", "").upper()
    
    # Profile
    profile = {
        "ID": member.get("ID"),
        "USERNAME": username,
        "DISPLAY_NAME": member.get("DISPLAY_NAME") or username,
        "FIRSTNAME": member.get("NAME") or member.get("FIRSTNAME") or "",
        "LASTNAME": member.get("LASTNAME") or "",
        "EMAIL": member.get("EMAIL") or "",
        "PHONE": member.get("PHONE") or member.get("GSM") or "",
        "RECDATE": member.get("RECDATE") or "",
        "LASTLOGIN": member.get("LLOGDATE") or member.get("LASTLOGIN") or "",
        "MEMBERSTATE": int(member.get("ACCSTATUS") or member.get("MEMBERSTATE") or 0),
        "PRICETYPE": member.get("PRICETYPE"),
    }
    
    # Balance
    current_balance = float(member.get("BAKIYE") or member.get("BALANCE") or 0)
    total_loaded = float(member.get("TOTALBAKIYE") or 0)
    total_spent = total_loaded - current_balance if total_loaded > current_balance else 0
    
    balance = {
        "current_balance": current_balance,
        "total_loaded": total_loaded,
        "total_spent": round(total_spent, 2),
    }
    
    # Stats
    total_minutes = int(member.get("TOTALACTMINUTE") or 0)
    
    # Calculate monthly stats from history
    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)
    monthly_minutes = 0
    monthly_sessions = 0
    
    for entry in history_entries:
        try:
            entry_date = entry.get("DATE", "")
            if entry_date:
                entry_dt = datetime.strptime(str(entry_date).split("T")[0], "%Y-%m-%d")
                if entry_dt >= month_start:
                    monthly_minutes += int(entry.get("USINGMIN") or 0)
                    if entry.get("USINGMIN", 0) > 0:
                        monthly_sessions += 1
        except:
            pass
    
    stats = {
        "total_minutes": total_minutes,
        "total_hours": round(total_minutes / 60, 1),
        "total_sessions": len(sessions) if sessions else 0,
        "monthly_minutes": monthly_minutes,
        "monthly_sessions": monthly_sessions,
        "streak_days": calculate_streak(history_entries),
    }
    
    # Get last activity date
    last_activity = None
    if history_entries:
        sorted_entries = sorted(history_entries, key=lambda x: x.get("ID", 0), reverse=True)
        if sorted_entries:
            last_activity = sorted_entries[0].get("DATE")
            stats["last_active"] = last_activity
    
    # Badges
    badges = compute_badges(
        member, 
        history_entries, 
        all_time_rank=ranks.get("all_time"),
        total_spent=total_spent,
        max_spent=ranks.get("max_spent", 0)
    )
    
    # Recent history (last N entries, sorted by ID descending)
    sorted_history = sorted(history_entries, key=lambda x: x.get("ID", 0), reverse=True)
    recent_history = sorted_history[:RECENT_HISTORY_COUNT]
    
    # Recent sessions (last N sessions, sorted by ID descending)
    sorted_sessions = sorted(sessions, key=lambda x: x.get("ID", 0), reverse=True) if sessions else []
    recent_sessions = sorted_sessions[:RECENT_SESSIONS_COUNT]
    
    return {
        "profile": remove_none_values(profile),
        "balance": remove_none_values(balance),
        "stats": remove_none_values(stats),
        "ranks": remove_none_values(ranks),
        "badges": remove_none_values(badges),
        "recent_history": [remove_none_values(h) for h in recent_history],
        "recent_sessions": [remove_none_values(s) for s in recent_sessions],
        "last_updated": datetime.now().isoformat(),
    }


# ==================== FIREBASE INIT ====================

def init_firebase():
    """Initialize Firebase connection."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    return db


# ==================== FDB SYNC ====================

def copy_fdb_file():
    """Copy Firebird database to working location."""
    os.makedirs(os.path.dirname(WORKING_FDB_PATH), exist_ok=True)
    try:
        shutil.copy2(SOURCE_FDB_PATH, WORKING_FDB_PATH)
        print("[OK] Copied DB file")
    except Exception as e:
        print(f"[ERROR] Failed to copy FDB file: {e}")
        raise


def connect_to_firebird():
    """Connect to Firebird database."""
    try:
        conn = fdb.connect(
            dsn=WORKING_FDB_PATH, 
            user=FIREBIRD_USER, 
            password=FIREBIRD_PASSWORD
        )
        return conn
    except Exception as e:
        print(f"[ERROR] Firebird connection failed: {e}")
        raise


def load_local_sync_state():
    """Load sync state from local file."""
    try:
        if os.path.exists(LOCAL_SYNC_FILE):
            with open(LOCAL_SYNC_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"[WARN] Could not load local sync state: {e}")
    
    return {
        "last_history_id": 0,
        "last_sync_time": None,
        "member_hashes": {}
    }


def save_local_sync_state(state):
    """Save sync state to local file."""
    try:
        with open(LOCAL_SYNC_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save local sync state: {e}")


def fetch_new_history_records(cursor, last_id):
    """Fetch only history records newer than last synced ID."""
    try:
        query = f"SELECT * FROM MEMBERSHISTORY WHERE ID > {last_id} ORDER BY ID ASC"
        cursor.execute(query)
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"[DATA] Found {len(rows)} NEW history records (after ID {last_id})")
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"[ERROR] Failed to fetch new history: {e}")
        return []


def process_and_upload_history(records, sync_state):
    """Process and upload only new history records."""
    if not records:
        print("   No new history records to upload")
        return sync_state["last_history_id"]
    
    by_user = defaultdict(dict)
    daily_aggregates = defaultdict(lambda: defaultdict(lambda: {"count": 0, "amount": 0}))
    max_id = sync_state["last_history_id"]
    
    for record in records:
        username = record.get("MEMBERS_USERNAME")
        if not username:
            continue
        
        username = str(username).strip().upper()
        if any(c in username for c in [".", "#", "$", "[", "]", "/"]):
            continue
        
        date_val = record.get("TARIH") or record.get("DATE", "")
        time_val = record.get("SAAT") or record.get("TIME", "")
        charge_val = record.get("MIKTAR") or record.get("CHARGE", 0)
        balance_val = record.get("KALAN") or record.get("BALANCE", 0)
        
        record_id = record.get("ID", 0)
        max_id = max(max_id, record_id)
        
        date_str = str(date_val).split("T")[0] if date_val else ""
        time_str = str(time_val).split(".")[0] if time_val else ""
        
        timestamp = None
        if date_str and time_str:
            timestamp = f"{date_str}T{time_str}"
        
        terminal = record.get("TERMINALNAME", "")
        if terminal:
            terminal = normalize_terminal_name(terminal) or terminal
        
        clean_record = {
            "ID": record_id,
            "USERNAME": username,
            "DATE": date_str or "",
            "TIME": time_str or "",
            "CHARGE": float(charge_val) if charge_val else 0,
            "BALANCE": float(balance_val) if balance_val else 0,
            "NOTE": record.get("NOTE") or "",
            "TERMINALNAME": terminal or "",
            "TERMINAL_SHORT": get_short_terminal_name(terminal) or "",
            "USINGMIN": float(record.get("USINGMIN") or 0),
            "USINGSEC": float(record.get("USINGSEC") or 0),
            "DISCOUNTNOTE": record.get("DISCOUNTNOTE") or "",
        }
        
        if timestamp:
            clean_record["TIMESTAMP"] = timestamp
        
        by_user[username][str(record_id)] = clean_record
        
        if date_str and clean_record["CHARGE"] > 0:
            daily_aggregates[date_str][username]["count"] += 1
            daily_aggregates[date_str][username]["amount"] += clean_record["CHARGE"]
    
    uploaded = 0
    for username, records_dict in by_user.items():
        try:
            ref = db.reference(f"{FB_PATHS.HISTORY}/{username}")
            ref.update(records_dict)
            uploaded += len(records_dict)
        except Exception as e:
            print(f"[WARN] Failed to upload history for {username}: {e}")
    
    print(f"   [OK] Uploaded {uploaded} history records for {len(by_user)} users")
    
    # Update daily aggregates
    for date_str, user_data in daily_aggregates.items():
        try:
            ref = db.reference(f"daily-summary/{date_str}/by_member")
            existing = ref.get() or {}
            
            for username, stats in user_data.items():
                if username in existing:
                    existing[username]["count"] = existing[username].get("count", 0) + stats["count"]
                    existing[username]["amount"] = existing[username].get("amount", 0) + stats["amount"]
                else:
                    existing[username] = stats
            
            ref.set(existing)
            
            total_ref = db.reference(f"daily-summary/{date_str}")
            total_amount = sum(u["amount"] for u in existing.values())
            total_count = sum(u["count"] for u in existing.values())
            total_ref.update({
                "total_amount": total_amount,
                "total_recharges": total_count,
                "unique_members": len(existing),
                "last_updated": datetime.now().isoformat()
            })
        except Exception as e:
            print(f"[WARN] Failed to update daily aggregate for {date_str}: {e}")
    
    if daily_aggregates:
        print(f"   [OK] Updated daily aggregates for {len(daily_aggregates)} dates")
    
    return max_id


def fetch_all_members(cursor):
    """Fetch all members."""
    try:
        cursor.execute("SELECT * FROM MEMBERS")
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"[ERROR] Failed to fetch members: {e}")
        return []


def build_and_upload_optimized_members(members_array, cursor):
    """
    Build and upload optimized v2 member data structure.
    
    This creates the single-key lookup structure at /members/{username}
    with embedded history, sessions, stats, ranks, and badges.
    """
    print("\n[V2] Building optimized member data structure...")
    
    # Fetch all history from Firebase (we need it for embedded data)
    try:
        all_history = db.reference(FB_PATHS.HISTORY).get() or {}
        print(f"   [DATA] Loaded history for {len(all_history)} users from Firebase")
    except Exception as e:
        print(f"   [WARN] Could not load history: {e}")
        all_history = {}
    
    # Fetch all sessions from Firebase
    try:
        all_sessions_by_member = db.reference(FB_PATHS.SESSIONS_BY_MEMBER).get() or {}
        print(f"   [DATA] Loaded sessions for {len(all_sessions_by_member)} members from Firebase")
    except Exception as e:
        print(f"   [WARN] Could not load sessions: {e}")
        all_sessions_by_member = {}
    
    # Build member ID to username lookup
    member_id_to_username = {}
    for m in members_array:
        if m.get("ID"):
            member_id_to_username[str(m["ID"])] = m.get("USERNAME", "").upper()
    
    # Calculate all-time ranks first (needed for badges)
    sorted_by_minutes = sorted(
        [m for m in members_array if m.get("TOTALACTMINUTE", 0) > 0],
        key=lambda x: x.get("TOTALACTMINUTE", 0),
        reverse=True
    )
    
    all_time_ranks = {}
    for i, m in enumerate(sorted_by_minutes):
        username = m.get("USERNAME", "").upper()
        all_time_ranks[username] = i + 1
    
    # Calculate max spending for badge comparison
    max_spent = 0
    for m in members_array:
        total_loaded = float(m.get("TOTALBAKIYE") or 0)
        current = float(m.get("BAKIYE") or m.get("BALANCE") or 0)
        spent = total_loaded - current if total_loaded > current else 0
        if spent > max_spent:
            max_spent = spent
    
    # Get current month/week for ranks
    now = datetime.now()
    month_key = f"{now.year}-{now.month:02d}"
    week_num = now.isocalendar()[1]
    week_key = f"{now.year}-W{week_num:02d}"
    
    # Try to load existing leaderboards for rank lookup
    monthly_ranks = {}
    weekly_ranks = {}
    try:
        monthly_lb = db.reference(f"{FB_PATHS.LEADERBOARDS}/monthly/{month_key}").get() or []
        for entry in monthly_lb:
            if entry and entry.get("username"):
                monthly_ranks[entry["username"].upper()] = entry.get("rank", 0)
        
        weekly_lb = db.reference(f"{FB_PATHS.LEADERBOARDS}/weekly/{week_key}").get() or []
        for entry in weekly_lb:
            if entry and entry.get("username"):
                weekly_ranks[entry["username"].upper()] = entry.get("rank", 0)
    except:
        pass
    
    # Build optimized data for each member
    optimized_members = {}
    processed = 0
    
    for member in members_array:
        username = member.get("USERNAME", "").upper()
        if not username:
            continue
        
        # Get history for this user
        user_history = all_history.get(username, {})
        if isinstance(user_history, dict):
            history_list = list(user_history.values())
        else:
            history_list = []
        
        # Get sessions for this user (by member ID)
        member_id = str(member.get("ID", 0))
        user_sessions = all_sessions_by_member.get(member_id, {})
        if isinstance(user_sessions, dict):
            sessions_list = list(user_sessions.values())
        else:
            sessions_list = []
        
        # Build ranks dict
        ranks = {
            "all_time": all_time_ranks.get(username),
            "monthly": monthly_ranks.get(username),
            "weekly": weekly_ranks.get(username),
            "max_spent": max_spent,
        }
        
        # Build optimized member data
        optimized_data = build_optimized_member_data(
            member, 
            history_list, 
            sessions_list, 
            ranks
        )
        
        optimized_members[username] = optimized_data
        processed += 1
    
    # Upload to Firebase at /members/{username}
    if optimized_members:
        try:
            # Upload in batches to avoid timeout
            batch_size = 50
            usernames = list(optimized_members.keys())
            
            for i in range(0, len(usernames), batch_size):
                batch = {u: optimized_members[u] for u in usernames[i:i+batch_size]}
                db.reference("members").update(batch)
            
            print(f"   [OK] Uploaded optimized data for {processed} members to /members/{{username}}")
        except Exception as e:
            print(f"   [ERROR] Failed to upload optimized members: {e}")
    
    return processed


def fetch_recent_sessions(cursor, hours=2):
    """Fetch only sessions from the last N hours."""
    try:
        query = f"""
            SELECT * FROM SESSIONS 
            WHERE ENDPOINT IS NULL 
               OR ENDPOINT > CURRENT_TIMESTAMP - {hours}/24.0
            ORDER BY ID DESC
        """
        cursor.execute(query)
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"[DATA] Found {len(rows)} recent sessions (last {hours} hours)")
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"[ERROR] Failed to fetch sessions: {e}")
        return []


def process_and_upload_sessions(records):
    """Upload recent sessions grouped by member."""
    by_member = defaultdict(dict)
    guest_sessions = {}
    
    for record in records:
        member_id = str(record.get("MEMBERID", 0))
        session_id = str(record.get("ID"))
        
        terminal = record.get("TERMINALNAME", "")
        if terminal:
            record["TERMINALNAME"] = normalize_terminal_name(terminal) or terminal
            record["TERMINAL_SHORT"] = get_short_terminal_name(terminal)
        
        clean_record = remove_none_values(record)
        
        if member_id == "0":
            guest_sessions[session_id] = clean_record
        else:
            by_member[member_id][session_id] = clean_record
    
    for member_id, sessions in by_member.items():
        try:
            ref = db.reference(f"{FB_PATHS.SESSIONS_BY_MEMBER}/{member_id}")
            ref.update(sessions)
        except Exception as e:
            print(f"[WARN] Failed to upload sessions for member {member_id}: {e}")
    
    if guest_sessions:
        try:
            db.reference(f"{FB_PATHS.SESSIONS_BY_MEMBER}/guest").update(guest_sessions)
        except Exception:
            pass
    
    total = sum(len(s) for s in by_member.values()) + len(guest_sessions)
    print(f"   [OK] Updated {total} sessions for {len(by_member)} members")


def clean_rtf(content):
    """Remove RTF formatting and extract plain text."""
    content = content.replace('\\par\n', '\n').replace('\\par', '\n')
    content = re.sub(r'\{\\rtf1[^}]*\}', '', content)
    content = re.sub(r'\{\\fonttbl[^}]*\}', '', content)
    content = re.sub(r'\{\\colortbl[^}]*\}', '', content)
    content = re.sub(r'\\cf\d+\s*', '', content)
    content = re.sub(r'\\viewkind\d+', '', content)
    content = re.sub(r'\\uc\d+', '', content)
    content = re.sub(r'\\pard', '', content)
    content = re.sub(r'\\f\d+', '', content)
    content = re.sub(r'\\fs\d+', '', content)
    content = re.sub(r'\\[a-z]+\d*\s*', '', content)
    content = content.replace('{', '').replace('}', '')
    content = re.sub(r'\n\s*\n', '\n', content)
    lines = [line.strip() for line in content.split('\n')]
    return '\n'.join(lines).strip()


MSG_PATTERNS = {
    'guest_session_start': re.compile(
        r'(\d{2}:\d{2}:\d{2})->\s*([^:]+):\s*Session started \(Time Limited\)\s*\((\d+)\s*min\)'
    ),
    'guest_session_end': re.compile(
        r'(\d{2}:\d{2}:\d{2})->\s*([^:]+):\s*Session closed\.\s*\[\s*Usage:\s*Rs\.\s*([\d.]+)\s*,\s*Total:\s*Rs\.\s*([\d.]+)\s*\]\*\s*Pre-Paid'
    ),
    'server_started': re.compile(
        r'(\d{2}:\d{2}:\d{2})->\s*Server started\.\.\.\s*\((\d{2})\.(\d{2})\.(\d{4})\)'
    ),
}


def parse_messages_file():
    """Parse messages.msg and extract guest sessions."""
    if not os.path.exists(MESSAGES_FILE):
        print(f"   [WARN] messages.msg not found at: {MESSAGES_FILE}")
        return None
    
    try:
        with open(MESSAGES_FILE, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except Exception as e:
        print(f"   [ERROR] Failed to read messages.msg: {e}")
        return None
    
    text = clean_rtf(content)
    lines = text.split('\n')
    
    current_date = None
    guest_sessions = []
    active_guest_sessions = {}
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        match = MSG_PATTERNS['server_started'].search(line)
        if match:
            time_str, day, month, year = match.groups()
            current_date = f"{year}-{month}-{day}"
            continue
        
        match = MSG_PATTERNS['guest_session_start'].search(line)
        if match:
            time_str, terminal, duration = match.groups()
            active_guest_sessions[terminal] = {
                'date': current_date,
                'start_time': time_str,
                'terminal': terminal,
                'duration_minutes': int(duration)
            }
            continue
        
        match = MSG_PATTERNS['guest_session_end'].search(line)
        if match:
            time_str, terminal, usage, total = match.groups()
            session_data = active_guest_sessions.pop(terminal, {})
            
            normalized_terminal = normalize_terminal_name(terminal) or terminal
            short_terminal = get_short_terminal_name(terminal) or terminal
            
            session = {
                'type': 'guest',
                'date': current_date or session_data.get('date') or '',
                'terminal': normalized_terminal or '',
                'terminal_short': short_terminal or '',
                'end_time': time_str or '',
                'usage': float(usage),
                'total': float(total),
                'prepaid': True
            }
            
            if session_data.get('start_time'):
                session['start_time'] = session_data.get('start_time')
            if session_data.get('duration_minutes'):
                session['duration_minutes'] = session_data.get('duration_minutes')
            
            guest_sessions.append(session)
            continue
    
    return guest_sessions


def upload_guest_sessions(guest_sessions):
    """Upload parsed guest sessions to Firebase."""
    if not guest_sessions:
        print("   No guest sessions to upload")
        return
    
    by_date = defaultdict(list)
    for session in guest_sessions:
        if session.get('date'):
            by_date[session['date']].append(session)
    
    for date_str, sessions in by_date.items():
        try:
            keyed_sessions = {}
            for s in sessions:
                key = f"{s['terminal_short']}_{s['end_time'].replace(':', '')}".replace(" ", "_")
                keyed_sessions[key] = s
            
            ref = db.reference(f"{FB_PATHS.GUEST_SESSIONS}/{date_str}")
            ref.update(keyed_sessions)
        except Exception as e:
            print(f"   [WARN] Failed to upload guest sessions for {date_str}: {e}")
    
    for date_str, sessions in by_date.items():
        try:
            total_revenue = sum(s['total'] for s in sessions)
            total_count = len(sessions)
            
            ref = db.reference(f"daily-summary/{date_str}")
            ref.update({
                'guest_sessions': total_count,
                'guest_revenue': total_revenue
            })
        except Exception:
            pass
    
    total = sum(len(s) for s in by_date.values())
    print(f"   [OK] Uploaded {total} guest sessions for {len(by_date)} dates")


# ==================== TERMINALS TABLE SYNC (Real-time from FDB) ====================

# Terminal status codes from PanCafe
TERMINAL_STATUS_CODES = {
    0: "offline",      # PC is off
    1: "available",    # Ready for use
    2: "reserved",     # Reserved/Booked
    3: "maintenance",  # Under maintenance
    4: "occupied",     # Session in progress (timed)
    5: "occupied",     # Session in progress (unlimited)
    6: "closing",      # Session ending
}


def fetch_terminals_from_fdb(cursor):
    """Fetch real-time terminal status directly from FDB TERMINALS table.
    
    Also joins with MEMBERS table to get username for member sessions.
    """
    try:
        # Query with LEFT JOIN to get member username
        cursor.execute("""
            SELECT 
                T.ID, T.NAME, T.TERMINALTYPE, T.TERMINALSTATUS, T.MEMBERID,
                T.STARTTIME, T.STARTDATE, T.TIMERMINUTE, T.MAC,
                T.OPENADMINNAME, T.SUREPARA, T.SESSIONPAUSED,
                M.USERNAME AS MEMBER_USERNAME, M.NAME AS MEMBER_FIRSTNAME
            FROM TERMINALS T
            LEFT JOIN MEMBERS M ON T.MEMBERID = M.ID
            ORDER BY T.NAME
        """)
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"[ERROR] Failed to fetch terminals: {e}")
        return []


def process_and_upload_terminal_status(terminals):
    """Process FDB TERMINALS and upload real-time status to Firebase."""
    if not terminals:
        print("   No terminals to process")
        return
    
    now = datetime.now()
    terminal_status = {}
    occupied_count = 0
    
    for t in terminals:
        name = t.get("NAME", "").strip()
        if not name:
            continue
        
        # Normalize terminal name
        name = normalize_terminal_name(name) or name
        status_code = t.get("TERMINALSTATUS", 0)
        status_str = TERMINAL_STATUS_CODES.get(status_code, "unknown")
        
        # Build terminal status object
        status_data = {
            "status": status_str,
            "status_code": status_code,
            "mac": t.get("MAC") or "",
            "last_updated": now.isoformat(),
        }
        
        # If occupied, add session info
        if status_str == "occupied":
            occupied_count += 1
            
            # Calculate session start datetime
            start_date = t.get("STARTDATE")
            start_time = t.get("STARTTIME")
            
            if start_date and start_time:
                try:
                    if isinstance(start_date, str):
                        session_start = datetime.fromisoformat(f"{start_date}T{start_time}")
                    else:
                        session_start = datetime.combine(start_date, start_time) if hasattr(start_time, 'hour') else None
                    
                    if session_start:
                        status_data["session_start"] = session_start.isoformat()
                        duration_min = (now - session_start).total_seconds() / 60
                        status_data["duration_minutes"] = round(duration_min, 1)
                except:
                    pass
            
            # Timer/duration info
            timer_min = t.get("TIMERMINUTE", 0)
            if timer_min and timer_min > 0:
                status_data["timer_minutes"] = timer_min
                status_data["session_type"] = "timed"
            else:
                status_data["session_type"] = "unlimited"
            
            # Member ID (0 = guest)
            member_id = t.get("MEMBERID", 0)
            status_data["member_id"] = member_id
            status_data["is_guest"] = (member_id == 0)
            
            # Member username (from JOIN)
            if member_id and member_id > 0:
                username = t.get("MEMBER_USERNAME")
                firstname = t.get("MEMBER_FIRSTNAME")
                if username:
                    status_data["member_username"] = username
                if firstname:
                    status_data["member_name"] = firstname
            
            # Session price
            price = t.get("SUREPARA", 0)
            if price and price > 0:
                status_data["session_price"] = float(price)
            
            # Admin who started the session
            admin = t.get("OPENADMINNAME")
            if admin:
                status_data["started_by"] = admin
            
            # Paused status
            if t.get("SESSIONPAUSED"):
                status_data["paused"] = True
        
        terminal_status[name] = status_data
    
    # Ensure all known terminals have a status
    for terminal in ALL_TERMINALS:
        if terminal not in terminal_status:
            terminal_status[terminal] = {
                "status": "offline",
                "status_code": 0,
                "mac": "",
                "last_updated": now.isoformat()
            }
    
    # Upload to Firebase
    try:
        # New path
        db.reference(FB_PATHS.TERMINAL_STATUS).set(terminal_status)
        
        # Legacy path (for backward compatibility)
        for name, data in terminal_status.items():
            safe_key = name.replace(" ", "_").replace("/", "_")
            try:
                db.reference(f"{FB_PATHS.LEGACY_STATUS}/{safe_key}").set(data)
            except:
                pass
        
        print(f"   [OK] Updated {len(terminal_status)} terminals ({occupied_count} occupied)")
    except Exception as e:
        print(f"   [ERROR] Failed to upload terminal status: {e}")


# ==================== KASAHAR (CASH REGISTER) SYNC ====================

def fetch_kasahar_records(cursor, days=7):
    """Fetch cash register transactions from the last N days."""
    try:
        cursor.execute(f"""
            SELECT ID, ADMINNAME, ISLEM, GELIRGIDER, TARIH, PRICE, NOTE, PAYMENTTYPE
            FROM KASAHAR
            WHERE TARIH >= CURRENT_DATE - {days}
            ORDER BY TARIH DESC
        """)
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"[DATA] Found {len(rows)} cash register records (last {days} days)")
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"[ERROR] Failed to fetch cash register: {e}")
        return []


# KASAHAR field meanings:
# ISLEM (Transaction Type): 1=Session, 2=Recharge, 3=Cafeteria, 4=Other
# GELIRGIDER (Income/Expense): 0=Income, 1=Expense
# PAYMENTTYPE: 0=Cash, 1=Card, 2=Balance, 3=Other

TRANSACTION_TYPES = {
    1: "session",      # Gaming session payment
    2: "recharge",     # Member balance recharge
    3: "cafeteria",    # Food/drink sale
    4: "other",        # Other transaction
}

PAYMENT_TYPES = {
    0: "cash",
    1: "card",
    2: "balance",      # Paid from member balance
    3: "other",
}


def process_and_upload_kasahar(records):
    """Process cash register records and compute daily summaries."""
    if not records:
        print("   No cash register records to process")
        return
    
    # Group by date for daily summaries
    daily_data = defaultdict(lambda: {
        "total_income": 0,
        "total_expense": 0,
        "net_revenue": 0,
        "transaction_count": 0,
        "by_type": defaultdict(float),
        "by_payment": defaultdict(float),
        "transactions": []
    })
    
    for record in records:
        tarih = record.get("TARIH")
        if not tarih:
            continue
        
        # Parse date
        if isinstance(tarih, str):
            try:
                dt = datetime.fromisoformat(tarih)
                date_str = dt.strftime("%Y-%m-%d")
            except:
                continue
        elif hasattr(tarih, 'strftime'):
            date_str = tarih.strftime("%Y-%m-%d")
        else:
            continue
        
        price = float(record.get("PRICE") or 0)
        is_expense = record.get("GELIRGIDER") == 1
        trans_type = TRANSACTION_TYPES.get(record.get("ISLEM"), "other")
        payment_type = PAYMENT_TYPES.get(record.get("PAYMENTTYPE"), "other")
        
        day = daily_data[date_str]
        day["transaction_count"] += 1
        
        if is_expense:
            day["total_expense"] += price
        else:
            day["total_income"] += price
            day["by_type"][trans_type] += price
            day["by_payment"][payment_type] += price
        
        day["net_revenue"] = day["total_income"] - day["total_expense"]
        
        # Store individual transaction (limit to 100 per day for Firebase)
        if len(day["transactions"]) < 100:
            trans = {
                "id": record.get("ID"),
                "time": tarih if isinstance(tarih, str) else tarih.isoformat() if hasattr(tarih, 'isoformat') else str(tarih),
                "amount": price,
                "type": trans_type,
                "payment": payment_type,
                "is_expense": is_expense,
                "admin": record.get("ADMINNAME") or "",
            }
            note = record.get("NOTE")
            if note:
                trans["note"] = note[:100]  # Truncate long notes
            day["transactions"].append(trans)
    
    # Upload daily summaries
    for date_str, data in daily_data.items():
        try:
            summary = {
                "date": date_str,
                "total_income": round(data["total_income"], 2),
                "total_expense": round(data["total_expense"], 2),
                "net_revenue": round(data["net_revenue"], 2),
                "transaction_count": data["transaction_count"],
                "by_type": {k: round(v, 2) for k, v in data["by_type"].items()},
                "by_payment": {k: round(v, 2) for k, v in data["by_payment"].items()},
                "last_updated": datetime.now().isoformat(),
            }
            
            # Remove None values
            summary = remove_none_values(summary)
            
            db.reference(f"{FB_PATHS.DAILY_REVENUE}/{date_str}").set(summary)
            
            # Also upload transactions for recent days only (last 3 days)
            recent_cutoff = datetime.now() - timedelta(days=3)
            try:
                trans_date = datetime.strptime(date_str, "%Y-%m-%d")
                if trans_date >= recent_cutoff and data["transactions"]:
                    db.reference(f"{FB_PATHS.CASH_REGISTER}/{date_str}").set(data["transactions"])
            except:
                pass
            
        except Exception as e:
            print(f"   [WARN] Failed to upload daily revenue for {date_str}: {e}")
    
    # Compute totals for display
    total_income = sum(d["total_income"] for d in daily_data.values())
    total_transactions = sum(d["transaction_count"] for d in daily_data.values())
    
    print(f"   [OK] Uploaded {len(daily_data)} days of revenue data")
    print(f"   [DATA] Total: Rs.{total_income:,.0f} from {total_transactions} transactions")


# ==================== LEADERBOARD CALCULATION ====================

def calculate_leaderboards_from_fdb(members, history_by_user, cursor):
    """Calculate leaderboards from local FDB data (no Firebase reads)."""
    print("\n[LEADERBOARDS] Calculating from local FDB data...")
    
    try:
        if not members:
            print("[WARN] No members data")
            return False
        
        print(f"[DATA] Processing {len(members)} members")
        
        # Use the history data passed in (already organized by username)
        all_history = history_by_user
        
        # All-time leaderboard (from members TOTALACTMINUTE)
        all_time = []
        members_with_minutes = [m for m in members if m.get("TOTALACTMINUTE", 0) > 0]
        print(f"[DEBUG] Found {len(members_with_minutes)} members with TOTALACTMINUTE > 0")
        
        # Show top 5 for debugging
        if members_with_minutes:
            top_debug = sorted(members_with_minutes, key=lambda m: m.get("TOTALACTMINUTE", 0), reverse=True)[:5]
            for td in top_debug:
                print(f"   - {td.get('USERNAME')}: {td.get('TOTALACTMINUTE')} minutes")
        
        sorted_members = sorted(
            members_with_minutes,
            key=lambda m: m.get("TOTALACTMINUTE", 0),
            reverse=True
        )  # All members with activity
        
        # Calculate max spending for badge comparison
        max_spent = 0
        for m in sorted_members:
            total_loaded = float(m.get("TOTALBAKIYE") or 0)
            current = float(m.get("BAKIYE") or m.get("BALANCE") or 0)
            spent = total_loaded - current if total_loaded > current else 0
            if spent > max_spent:
                max_spent = spent
        
        for i, m in enumerate(sorted_members):
            # Use DISPLAY_NAME for original case, fallback to USERNAME
            display_name = m.get("DISPLAY_NAME") or m.get("USERNAME") or ""
            username = (m.get("USERNAME") or "").upper()
            
            entry = {
                "rank": i + 1,
                "username": display_name,
                "total_minutes": int(m.get("TOTALACTMINUTE") or 0),
                "total_hours": round((m.get("TOTALACTMINUTE") or 0) / 60, 1),
            }
            if m.get("RECDATE"):
                entry["member_since"] = m.get("RECDATE")
            if m.get("ID") is not None:
                entry["member_id"] = m.get("ID")
            
            # Get last activity date from history
            user_history = all_history.get(username, {})
            if isinstance(user_history, dict) and user_history:
                history_list = list(user_history.values())
                sorted_history = sorted(history_list, key=lambda x: x.get("ID", 0), reverse=True)
                if sorted_history:
                    last_date = sorted_history[0].get("DATE")
                    if last_date:
                        entry["last_active"] = last_date
                
                # Calculate streak
                streak = calculate_streak(history_list)
                if streak > 0:
                    entry["streak_days"] = streak
            
            # Pre-compute badges for frontend
            badges = {}
            if i == 0:
                badges["champion"] = True
            elif i == 1:
                badges["runner_up"] = True
            elif i == 2:
                badges["third_place"] = True
            
            total_minutes = m.get("TOTALACTMINUTE", 0)
            if total_minutes >= 10000:  # 166+ hours
                badges["grinder"] = True
            
            # Big spender badge
            total_loaded = float(m.get("TOTALBAKIYE") or 0)
            current = float(m.get("BAKIYE") or m.get("BALANCE") or 0)
            spent = total_loaded - current if total_loaded > current else 0
            if max_spent > 0 and spent >= max_spent * 0.9:
                badges["big_spender"] = True
            
            if badges:
                entry["badges"] = badges
            
            all_time.append(entry)
        
        db.reference(f"{FB_PATHS.LEADERBOARDS}/all-time").set(all_time)
        print(f"[OK] Updated all-time leaderboard ({len(all_time)} entries with badges)")
        
        # Build member ID to display name lookup (preserve original case)
        member_id_to_display_name = {}
        for m in members:
            member_id = m.get("ID")
            display_name = m.get("DISPLAY_NAME") or m.get("USERNAME") or ""
            if member_id and display_name:
                member_id_to_display_name[member_id] = display_name
        
        # Fetch sessions from FDB for monthly/weekly calculation using existing cursor
        now = datetime.now()
        month_start = datetime(now.year, now.month, 1)
        month_key = f"{now.year}-{now.month:02d}"
        
        day_of_week = now.weekday()
        week_start = now - timedelta(days=day_of_week)
        week_start = datetime(week_start.year, week_start.month, week_start.day)
        week_num = now.isocalendar()[1]
        week_key = f"{now.year}-W{week_num:02d}"
        
        monthly_stats = defaultdict(lambda: {"minutes": 0, "sessions": 0, "spent": 0})
        weekly_stats = defaultdict(lambda: {"minutes": 0, "sessions": 0})
        
        # Query sessions from FDB using the passed cursor
        month_start_str = month_start.strftime("%Y-%m-%d")
        
        try:
            query = f"""
                SELECT MEMBERID, USINGMIN, TOTALPRICE, STARTPOINT 
                FROM SESSIONS 
                WHERE MEMBERID > 0 AND STARTPOINT >= '{month_start_str}'
            """
            cursor.execute(query)
            
            for row in cursor.fetchall():
                member_id = row[0]
                usingmin = int(row[1] or 0)
                totalprice = float(row[2] or 0)
                startpoint = row[3]
                
                username = member_id_to_display_name.get(member_id)
                if not username:
                    continue
                
                # Add to monthly stats
                monthly_stats[username]["sessions"] += 1
                monthly_stats[username]["minutes"] += usingmin
                monthly_stats[username]["spent"] += totalprice
                
                # Check if also in current week
                if isinstance(startpoint, str):
                    try:
                        session_dt = datetime.fromisoformat(startpoint)
                    except:
                        continue
                elif hasattr(startpoint, 'year'):
                    session_dt = startpoint
                else:
                    continue
                
                if session_dt >= week_start:
                    weekly_stats[username]["sessions"] += 1
                    weekly_stats[username]["minutes"] += usingmin
            
            print(f"[OK] Calculated monthly/weekly stats from FDB SESSIONS")
            
        except Exception as e:
            print(f"[WARN] Could not query SESSIONS, using history data: {e}")
            # Fallback to history data
            for username, records in all_history.items():
                if not isinstance(records, dict):
                    continue
                for record_id, record in records.items():
                    if not isinstance(record, dict):
                        continue
                    record_date = record.get("DATE", "")
                    if not record_date:
                        continue
                    try:
                        record_dt = datetime.strptime(str(record_date).split("T")[0], "%Y-%m-%d")
                        if record_dt >= month_start:
                            monthly_stats[username]["sessions"] += 1
                            usingmin = float(record.get("USINGMIN") or 0)
                            monthly_stats[username]["minutes"] += usingmin
                            charge = float(record.get("CHARGE") or 0)
                            if charge > 0:
                                monthly_stats[username]["spent"] += charge
                        if record_dt >= week_start:
                            weekly_stats[username]["sessions"] += 1
                            usingmin = float(record.get("USINGMIN") or 0)
                            weekly_stats[username]["minutes"] += usingmin
                    except:
                        pass
        
        # Build monthly leaderboard - sorted array by minutes (highest first)
        monthly_list = []
        for username, stats in monthly_stats.items():
            if stats["sessions"] > 0:
                monthly_list.append({
                    "username": username,
                    "total_minutes": int(stats["minutes"]),
                    "sessions_count": int(stats["sessions"]),
                    "total_spent": round(stats["spent"], 2),
                    "total_hours": round(stats["minutes"] / 60, 1)
                })
        
        # Sort by minutes descending and add rank
        monthly_list.sort(key=lambda x: x["total_minutes"], reverse=True)
        for i, entry in enumerate(monthly_list):
            entry["rank"] = i + 1
        
        if monthly_list:
            db.reference(f"{FB_PATHS.LEADERBOARDS}/monthly/{month_key}").set(monthly_list)
            print(f"[OK] Updated monthly leaderboard ({len(monthly_list)} entries)")
        else:
            print(f"[WARN] No activity data for {month_key}")
        
        # Build weekly leaderboard - sorted array by minutes (highest first)
        weekly_list = []
        for username, stats in weekly_stats.items():
            if stats["sessions"] > 0:
                weekly_list.append({
                    "username": username,
                    "total_minutes": int(stats["minutes"]),
                    "sessions_count": int(stats["sessions"]),
                    "total_hours": round(stats["minutes"] / 60, 1)
                })
        
        # Sort by minutes descending and add rank
        weekly_list.sort(key=lambda x: x["total_minutes"], reverse=True)
        for i, entry in enumerate(weekly_list):
            entry["rank"] = i + 1
        
        if weekly_list:
            db.reference(f"{FB_PATHS.LEADERBOARDS}/weekly/{week_key}").set(weekly_list)
            print(f"[OK] Updated weekly leaderboard ({len(weekly_list)} entries)")
        
        # Update sync metadata
        db.reference(f"{FB_PATHS.SYNC_META}/leaderboard").update({
            "last_sync": datetime.now().isoformat(),
            "status": "ok",
            "method": "firebase_calculation"
        })
        
        return True
        
    except Exception as e:
        print(f"[ERROR] Failed to calculate leaderboards: {e}")
        import traceback
        traceback.print_exc()
        return False


# ==================== MAIN ====================

def run_terminals_sync():
    """
    Quick terminal status sync only.
    Called frequently (every 2 minutes) for real-time PC status.
    """
    start_time = datetime.now()
    conn = None
    
    try:
        init_firebase()
        copy_fdb_file()
        conn = connect_to_firebird()
        cursor = conn.cursor()
        
        terminals = fetch_terminals_from_fdb(cursor)
        process_and_upload_terminal_status(terminals)
        
        db.reference(f"{FB_PATHS.SYNC_META}/terminals").update({
            "last_sync": datetime.now().isoformat(),
            "status": "ok",
            "terminal_count": len(terminals)
        })
        
        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"[TERMINALS] {len(terminals)} PCs synced in {elapsed:.1f}s")
        return True
        
    except Exception as e:
        print(f"[ERROR] Terminals sync failed: {e}")
        return False
        
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


def run_fdb_sync():
    """
    Full FDB database sync.
    Includes: Members, History, Sessions, Leaderboards, Cash Register.
    Called periodically (every 15 minutes).
    """
    start_time = datetime.now()
    conn = None
    
    print("\n" + "="*60)
    print("OceanZ FDB Sync")
    print(f"   Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)
    
    try:
        init_firebase()
        
        # Open single FDB connection
        print("\n[INIT] Opening database connection...")
        copy_fdb_file()
        conn = connect_to_firebird()
        cursor = conn.cursor()
        
        sync_state = load_local_sync_state()
        
        # ========== 1. MEMBERS ==========
        print("\n[1/5] Members (V2 Structure)...")
        members = fetch_all_members(cursor)
        v2_count = build_and_upload_optimized_members(members, cursor)
        print(f"      {v2_count} profiles uploaded")
        
        # ========== 2. HISTORY ==========
        print("\n[2/5] History (incremental)...")
        new_records = fetch_new_history_records(cursor, sync_state.get("last_history_id", 0))
        new_max_id = process_and_upload_history(new_records, sync_state)
        sync_state["last_history_id"] = new_max_id
        print(f"      {len(new_records)} new records")
        
        # Load history for leaderboards
        try:
            history_by_user = db.reference(FB_PATHS.HISTORY).get() or {}
        except:
            history_by_user = {}
        
        # Sessions
        print("      Processing sessions...")
        sessions = fetch_recent_sessions(cursor, hours=2)
        process_and_upload_sessions(sessions)
        
        # Guest sessions
        guest_sessions = parse_messages_file()
        if guest_sessions:
            upload_guest_sessions(guest_sessions)
        
        # ========== 3. LEADERBOARDS ==========
        print("\n[3/5] Leaderboards (local calculation)...")
        calculate_leaderboards_from_fdb(members, history_by_user, cursor)
        print("      All-time, monthly, weekly updated")
        
        # ========== 4. TERMINALS ==========
        print("\n[4/5] Terminals...")
        terminals = fetch_terminals_from_fdb(cursor)
        process_and_upload_terminal_status(terminals)
        print(f"      {len(terminals)} PCs")
        
        # ========== 5. CASH REGISTER ==========
        print("\n[5/5] Cash Register (7 days)...")
        kasahar_records = fetch_kasahar_records(cursor, days=7)
        process_and_upload_kasahar(kasahar_records)
        print(f"      {len(kasahar_records)} transactions")
        
        # Save state
        sync_state["last_sync_time"] = start_time.isoformat()
        save_local_sync_state(sync_state)
        
        db.reference("sync-meta").update({
            "last_sync": datetime.now().isoformat(),
            "last_history_id": new_max_id,
            "records_synced": len(new_records)
        })
        
        # Summary
        elapsed = (datetime.now() - start_time).total_seconds()
        print("\n" + "="*60)
        print(f"[DONE] FDB sync completed in {elapsed:.1f}s")
        print(f"   Members: {v2_count} | History: {len(new_records)} | Terminals: {len(terminals)}")
        print("="*60 + "\n")
        
        db.reference(f"{FB_PATHS.SYNC_CONTROL}/last_sync").set({
            "timestamp": datetime.now().isoformat(),
            "duration_seconds": round(elapsed, 2),
            "success": True
        })
        
        return True
        
    except Exception as e:
        print(f"\n[ERROR] FDB sync failed: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


def main():
    """Main entry point - runs full FDB sync."""
    success = run_fdb_sync()
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
