#!/usr/bin/env python3
"""
OceanZ Gaming Cafe - Complete Unified Sync Script

This single script handles ALL sync operations:
1. FDB Database Sync (Members, History, Sessions, Guest Sessions)
2. IP Logs & Terminal Status Sync
3. Leaderboard Calculation (from Firebase data)

No dependencies on other scripts - everything is inline.
"""

import os
import re
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
    FB_PATHS, FIREBIRD_USER, FIREBIRD_PASSWORD, IPLOG_BASE_PATH,
    ALL_TERMINALS, SESSION_RETENTION_DAYS,
    normalize_terminal_name, get_short_terminal_name
)

# Messages.msg file path (same folder as usdb.dat)
MESSAGES_FILE = os.path.join(os.path.dirname(SOURCE_FDB_PATH), "messages.msg")

# Local state files
LOCAL_SYNC_FILE = os.path.join(os.path.dirname(__file__), ".sync_state.json")
LOCAL_IPLOGS_FILE = os.path.join(os.path.dirname(__file__), ".iplogs_state.json")

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


def process_and_upload_members(records, sync_state):
    """Upload only changed member profiles."""
    old_hashes = sync_state.get("member_hashes", {})
    new_hashes = {}
    members_to_update = {}
    members_array = []
    
    for record in records:
        username = record.get("USERNAME")
        if not username or not isinstance(username, str):
            continue
        
        username = username.strip().upper()
        if any(c in username for c in [".", "#", "$", "[", "]", "/"]):
            continue
        
        clean_record = {
            "USERNAME": username,
            "BALANCE": float(record.get("BALANCE") or 0),
            "FIRSTNAME": record.get("FIRSTNAME") or "",
            "LASTNAME": record.get("LASTNAME") or "",
            "EMAIL": record.get("EMAIL") or "",
            "PHONE": record.get("PHONE") or "",
            "MEMBERSTATE": int(record.get("MEMBERSTATE") or 0),
            "ISLOGIN": int(record.get("ISLOGIN") or 0),
            "TIMEMINS": float(record.get("TIMEMINS") or 0),
            "TOTALUSEDMIN": float(record.get("TOTALUSEDMIN") or 0),
            "TOTALACTMINUTE": float(record.get("TOTALACTMINUTE") or 0),
        }
        
        if record.get("ID") is not None:
            clean_record["ID"] = record.get("ID")
        if record.get("GROUPID") is not None:
            clean_record["GROUPID"] = record.get("GROUPID")
        if record.get("JOININGDATE"):
            clean_record["JOININGDATE"] = record.get("JOININGDATE")
        if record.get("LASTCONNECTION"):
            clean_record["LASTCONNECTION"] = record.get("LASTCONNECTION")
        if record.get("RECDATE"):
            clean_record["RECDATE"] = record.get("RECDATE")
        
        members_array.append(clean_record)
        record_hash = get_record_hash(clean_record)
        new_hashes[username] = record_hash
        
        if old_hashes.get(username) != record_hash:
            members_to_update[username] = clean_record
    
    if members_to_update:
        print(f"[DATA] Found {len(members_to_update)} CHANGED members (out of {len(records)})")
        for username, data in members_to_update.items():
            try:
                db.reference(f"{FB_PATHS.MEMBERS}/{username}").set(data)
            except Exception as e:
                print(f"[WARN] Failed to upload member {username}: {e}")
        print(f"   [OK] Updated {len(members_to_update)} member profiles")
    else:
        print("   No member changes detected")
    
    if members_to_update:
        try:
            db.reference(FB_PATHS.LEGACY_MEMBERS).set(members_array)
            print(f"   [OK] Updated legacy members array ({len(members_array)} members)")
        except Exception as e:
            print(f"[WARN] Failed to update legacy members: {e}")
    
    return new_hashes


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


# ==================== IP LOGS SYNC ====================

def load_iplogs_state():
    """Load IP logs sync state."""
    try:
        if os.path.exists(LOCAL_IPLOGS_FILE):
            with open(LOCAL_IPLOGS_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    
    return {
        "last_file": None,
        "last_line_count": 0,
        "terminal_status_cache": {},
        "open_sessions": {},
        "cleanup_counter": 0
    }


def save_iplogs_state(state):
    """Save IP logs sync state."""
    try:
        with open(LOCAL_IPLOGS_FILE, "w") as f:
            json.dump(state, f, indent=2, default=str)
    except Exception as e:
        print(f"[WARN] Could not save IP logs state: {e}")


def get_log_file_info():
    """Get current log file path and info."""
    today = datetime.now()
    yesterday = today - timedelta(days=1)
    
    candidates = [
        (f"Log_{today.strftime('%d%m%Y')}.csv", today.strftime('%d%m%Y')),
        (f"Log_{yesterday.strftime('%d%m%Y')}.csv", yesterday.strftime('%d%m%Y'))
    ]
    
    for fname, date_key in candidates:
        path = os.path.join(IPLOG_BASE_PATH, fname)
        if os.path.isfile(path):
            return path, fname, date_key
    
    return None, None, None


def read_new_log_lines(state):
    """Read only NEW log lines since last sync."""
    path, fname, date_key = get_log_file_info()
    
    if not path:
        print("[WARN] No log file found")
        return [], None, 0
    
    last_file = state.get("last_file")
    last_line_count = state.get("last_line_count", 0)
    
    try:
        with open(path, "r", encoding="windows-1254") as f:
            all_lines = f.readlines()
    except Exception as e:
        print(f"[ERROR] Error reading log file: {e}")
        return [], fname, 0
    
    current_line_count = len(all_lines)
    
    if last_file != fname:
        print(f"[FILE] New log file: {fname} ({current_line_count} lines)")
        new_lines = all_lines
    elif current_line_count > last_line_count:
        new_lines = all_lines[last_line_count:]
        print(f"[FILE] Reading {len(new_lines)} new lines (was {last_line_count}, now {current_line_count})")
    else:
        print("   No new log entries")
        return [], fname, current_line_count
    
    return new_lines, fname, current_line_count


def parse_log_lines(lines):
    """Parse log lines into structured entries."""
    entries = []
    
    for line in lines:
        parts = line.strip(";\n").split(";")
        if len(parts) != 6:
            continue
        
        status, terminal, mac, ip, date_str, time_str = parts
        
        try:
            dt = datetime.strptime(f"{date_str} {time_str}", "%d.%m.%Y %H:%M:%S")
        except ValueError:
            continue
        
        terminal_normalized = normalize_terminal_name(terminal) or terminal
        
        entries.append({
            "status": status,
            "terminal": terminal_normalized,
            "mac": mac,
            "ip": ip,
            "datetime": dt
        })
    
    entries.sort(key=lambda x: x["datetime"])
    return entries


def process_entries_incremental(entries, state):
    """Process log entries incrementally."""
    open_sessions = {}
    for terminal, data in state.get("open_sessions", {}).items():
        if data and "datetime" in data:
            data["datetime"] = datetime.fromisoformat(data["datetime"])
            open_sessions[terminal] = data
    
    completed_sessions = []
    terminal_status = dict(state.get("terminal_status_cache", {}))
    
    for entry in entries:
        terminal = entry["terminal"]
        
        if entry["status"] == "Açildi":
            open_sessions[terminal] = entry
            terminal_status[terminal] = {
                "status": "occupied",
                "mac": entry["mac"],
                "ip": entry["ip"],
                "session_start": entry["datetime"].isoformat(),
                "last_updated": entry["datetime"].isoformat()
            }
        elif entry["status"] == "Kapandi":
            if terminal in open_sessions:
                start = open_sessions.pop(terminal)
                duration = (entry["datetime"] - start["datetime"]).total_seconds() / 60
                
                completed_sessions.append({
                    "terminal": terminal,
                    "mac": start["mac"],
                    "ip": start["ip"],
                    "start": start["datetime"].isoformat(),
                    "end": entry["datetime"].isoformat(),
                    "duration_minutes": round(duration, 2),
                    "active": False,
                    "date": entry["datetime"].strftime("%Y-%m-%d")
                })
            
            terminal_status[terminal] = {
                "status": "available",
                "mac": entry["mac"],
                "ip": entry["ip"],
                "last_updated": entry["datetime"].isoformat()
            }
    
    now = datetime.now()
    active_sessions = []
    
    for terminal, start in open_sessions.items():
        duration = (now - start["datetime"]).total_seconds() / 60
        active_sessions.append({
            "terminal": terminal,
            "mac": start["mac"],
            "ip": start["ip"],
            "start": start["datetime"].isoformat(),
            "duration_minutes": round(duration, 2),
            "active": True
        })
        
        terminal_status[terminal] = {
            "status": "occupied",
            "mac": start["mac"],
            "ip": start["ip"],
            "session_start": start["datetime"].isoformat(),
            "duration_minutes": round(duration, 2),
            "last_updated": now.isoformat()
        }
    
    serializable_open = {}
    for terminal, data in open_sessions.items():
        serializable_open[terminal] = {
            "mac": data["mac"],
            "ip": data["ip"],
            "datetime": data["datetime"].isoformat()
        }
    
    return completed_sessions, active_sessions, terminal_status, serializable_open


def build_complete_terminal_status(session_status):
    """Ensure all terminals have a status."""
    status_map = dict(session_status)
    now = datetime.now().isoformat()
    
    for terminal in ALL_TERMINALS:
        if terminal not in status_map:
            status_map[terminal] = {
                "status": "available",
                "mac": "",
                "ip": "",
                "last_updated": now
            }
    
    return status_map


def upload_sessions(completed_sessions):
    """Upload only newly completed sessions."""
    if not completed_sessions:
        return
    
    print(f"   [UPLOAD] Uploading {len(completed_sessions)} completed sessions")
    
    for session in completed_sessions:
        session_id = f"{session['terminal'].replace(' ', '_')}__{session['start'].replace(':', '-').replace('.', '-')}"
        try:
            db.reference(f"{FB_PATHS.SESSIONS}/{session_id}").set(session)
        except Exception as e:
            print(f"[WARN] Failed to upload session: {e}")


def upload_terminal_status(terminal_status, old_cache):
    """Upload only changed terminal statuses."""
    changes = 0
    
    for terminal, data in terminal_status.items():
        old_data = old_cache.get(terminal, {})
        
        if (old_data.get("status") != data.get("status") or 
            old_data.get("session_start") != data.get("session_start")):
            
            safe_key = terminal.replace(" ", "_").replace("/", "_")
            
            try:
                db.reference(f"{FB_PATHS.TERMINAL_STATUS}/{safe_key}").set(data)
                db.reference(f"{FB_PATHS.LEGACY_STATUS}/{terminal}").set(data)
                changes += 1
            except Exception as e:
                print(f"[WARN] Failed to update {terminal}: {e}")
    
    if changes > 0:
        print(f"   [UPLOAD] Updated {changes} terminal statuses")
    else:
        print("   No terminal status changes")


def cleanup_old_sessions(state):
    """Clean up old sessions periodically."""
    cleanup_counter = state.get("cleanup_counter", 0) + 1
    state["cleanup_counter"] = cleanup_counter
    
    if cleanup_counter % 10 != 0:
        return
    
    print("[CLEANUP] Running periodic cleanup...")
    
    try:
        sessions_ref = db.reference(FB_PATHS.SESSIONS)
        all_sessions = sessions_ref.get()
        
        if not all_sessions:
            return
        
        now = datetime.now()
        cutoff = now - timedelta(days=SESSION_RETENTION_DAYS)
        deleted = 0
        
        for key, session in all_sessions.items():
            try:
                start_str = session.get("start")
                if start_str:
                    session_start = datetime.fromisoformat(start_str.replace("Z", ""))
                    if session_start < cutoff:
                        sessions_ref.child(key).delete()
                        deleted += 1
            except Exception:
                pass
        
        if deleted > 0:
            print(f"   [OK] Deleted {deleted} old sessions")
    except Exception as e:
        print(f"[WARN] Cleanup error: {e}")


# ==================== LEADERBOARD CALCULATION ====================

def calculate_leaderboards_from_firebase():
    """Calculate leaderboards directly from Firebase data (like frontend does)."""
    print(f"\n{'='*60}")
    print("[LEADERBOARDS] Calculating from Firebase data...")
    print(f"{'='*60}")
    
    try:
        # Fetch members
        members_ref = db.reference(FB_PATHS.LEGACY_MEMBERS)
        members_data = members_ref.get()
        
        if not members_data:
            print("[WARN] No members data found")
            return False
        
        if isinstance(members_data, list):
            members = [m for m in members_data if m]
        elif isinstance(members_data, dict):
            members = list(members_data.values())
        else:
            members = []
        
        print(f"[DATA] Loaded {len(members)} members")
        
        # Fetch history
        history_ref = db.reference(FB_PATHS.HISTORY)
        all_history = history_ref.get() or {}
        
        # All-time leaderboard (from members TOTALACTMINUTE)
        all_time = []
        sorted_members = sorted(
            [m for m in members if m.get("TOTALACTMINUTE", 0) > 0],
            key=lambda m: m.get("TOTALACTMINUTE", 0),
            reverse=True
        )[:50]
        
        for i, m in enumerate(sorted_members):
            entry = {
                "rank": i + 1,
                "username": m.get("USERNAME") or "",
                "total_minutes": int(m.get("TOTALACTMINUTE") or 0),
                "total_hours": round((m.get("TOTALACTMINUTE") or 0) / 60, 1),
            }
            if m.get("RECDATE"):
                entry["member_since"] = m.get("RECDATE")
            if m.get("ID") is not None:
                entry["member_id"] = m.get("ID")
            all_time.append(entry)
        
        db.reference(f"{FB_PATHS.LEADERBOARDS}/all-time").set(all_time)
        print(f"[OK] Updated all-time leaderboard ({len(all_time)} entries)")
        
        # Monthly leaderboard
        now = datetime.now()
        month_start = datetime(now.year, now.month, 1)
        month_key = f"{now.year}-{now.month:02d}"
        
        monthly_stats = defaultdict(lambda: {"minutes": 0, "sessions": 0, "spent": 0})
        
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
                    record_dt = datetime.strptime(record_date, "%Y-%m-%d")
                    if record_dt >= month_start:
                        monthly_stats[username]["sessions"] += 1
                        monthly_stats[username]["minutes"] += float(record.get("USINGMIN") or 0)
                        charge = float(record.get("CHARGE") or 0)
                        if charge < 0:
                            monthly_stats[username]["spent"] += abs(charge)
                except:
                    pass
        
        monthly_leaderboard = {}
        for username, stats in monthly_stats.items():
            if stats["minutes"] > 0:
                monthly_leaderboard[username] = {
                    "username": username,
                    "total_minutes": int(stats["minutes"]),
                    "sessions_count": int(stats["sessions"]),
                    "total_spent": round(stats["spent"], 2),
                }
        
        if monthly_leaderboard:
            db.reference(f"{FB_PATHS.LEADERBOARDS}/monthly/{month_key}").set(monthly_leaderboard)
            print(f"[OK] Updated monthly leaderboard ({len(monthly_leaderboard)} entries)")
        else:
            print(f"[WARN] No activity data for {month_key}")
        
        # Weekly leaderboard
        day_of_week = now.weekday()
        week_start = now - timedelta(days=day_of_week)
        week_start = datetime(week_start.year, week_start.month, week_start.day)
        week_num = now.isocalendar()[1]
        week_key = f"{now.year}-W{week_num:02d}"
        
        weekly_stats = defaultdict(lambda: {"minutes": 0, "sessions": 0})
        
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
                    record_dt = datetime.strptime(record_date, "%Y-%m-%d")
                    if record_dt >= week_start:
                        weekly_stats[username]["sessions"] += 1
                        weekly_stats[username]["minutes"] += float(record.get("USINGMIN") or 0)
                except:
                    pass
        
        weekly_leaderboard = {}
        for username, stats in weekly_stats.items():
            if stats["minutes"] > 0:
                weekly_leaderboard[username] = {
                    "username": username,
                    "total_minutes": int(stats["minutes"]),
                    "sessions_count": int(stats["sessions"]),
                    "total_hours": round(stats["minutes"] / 60, 1)
                }
        
        if weekly_leaderboard:
            db.reference(f"{FB_PATHS.LEADERBOARDS}/weekly/{week_key}").set(weekly_leaderboard)
            print(f"[OK] Updated weekly leaderboard ({len(weekly_leaderboard)} entries)")
        
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

def main():
    """Main unified sync routine."""
    start_time = datetime.now()
    
    print("\n" + "="*60)
    print("OceanZ Complete Unified Sync")
    print(f"   Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60 + "\n")
    
    try:
        # Initialize Firebase
        init_firebase()
        
        # ========== 1. FDB SYNC ==========
        print("\n" + "="*60)
        print("[STEP 1/3] FDB Database Sync")
        print("="*60)
        
        copy_fdb_file()
        conn = connect_to_firebird()
        cursor = conn.cursor()
        
        sync_state = load_local_sync_state()
        last_sync = sync_state.get("last_sync_time")
        if last_sync:
            print(f"[INFO] Last sync: {last_sync}")
        else:
            print("[INFO] First sync - will upload all data")
        
        # History
        print("\n[STEP] Processing HISTORY (incremental)...")
        new_records = fetch_new_history_records(cursor, sync_state.get("last_history_id", 0))
        new_max_id = process_and_upload_history(new_records, sync_state)
        sync_state["last_history_id"] = new_max_id
        
        # Members
        print("\n[STEP] Processing MEMBERS (change detection)...")
        members = fetch_all_members(cursor)
        new_hashes = process_and_upload_members(members, sync_state)
        sync_state["member_hashes"] = new_hashes
        
        # Sessions
        print("\n[STEP] Processing SESSIONS (recent only)...")
        sessions = fetch_recent_sessions(cursor, hours=2)
        process_and_upload_sessions(sessions)
        
        # Guest sessions
        print("\n[STEP] Processing GUEST SESSIONS (from messages.msg)...")
        guest_sessions = parse_messages_file()
        if guest_sessions:
            upload_guest_sessions(guest_sessions)
        
        sync_state["last_sync_time"] = start_time.isoformat()
        save_local_sync_state(sync_state)
        
        # Update Firebase sync meta
        db.reference("sync-meta").update({
            "last_fdb_sync": start_time.isoformat(),
            "last_history_id": new_max_id,
            "records_synced": len(new_records)
        })
        
        conn.close()
        print("\n[OK] FDB sync completed")
        
        # ========== 2. IP LOGS SYNC ==========
        print("\n" + "="*60)
        print("[STEP 2/3] IP Logs & Terminal Status Sync")
        print("="*60)
        
        iplogs_state = load_iplogs_state()
        old_cache = dict(iplogs_state.get("terminal_status_cache", {}))
        
        cleanup_old_sessions(iplogs_state)
        
        new_lines, current_file, line_count = read_new_log_lines(iplogs_state)
        
        if new_lines:
            entries = parse_log_lines(new_lines)
            
            if entries:
                completed, active, terminal_status, open_sessions = process_entries_incremental(entries, iplogs_state)
                terminal_status = build_complete_terminal_status(terminal_status)
                
                upload_sessions(completed)
                upload_terminal_status(terminal_status, old_cache)
                
                iplogs_state["terminal_status_cache"] = terminal_status
                iplogs_state["open_sessions"] = open_sessions
                
                occupied = sum(1 for t in terminal_status.values() if t["status"] == "occupied")
                print(f"   [DATA] Active: {len(active)} | Completed: {len(completed)} | Occupied: {occupied}/{len(ALL_TERMINALS)}")
        
        iplogs_state["last_file"] = current_file
        iplogs_state["last_line_count"] = line_count
        iplogs_state["last_sync"] = start_time.isoformat()
        
        save_iplogs_state(iplogs_state)
        
        db.reference(f"{FB_PATHS.SYNC_META}/iplogs").update({
            "last_sync": datetime.now().isoformat(),
            "status": "ok"
        })
        
        print("\n[OK] IP logs sync completed")
        
        # ========== 3. LEADERBOARDS ==========
        print("\n" + "="*60)
        print("[STEP 3/3] Leaderboard Calculation")
        print("="*60)
        
        if calculate_leaderboards_from_firebase():
            print("\n[OK] Leaderboard calculation completed")
        else:
            print("\n[WARN] Leaderboard calculation had errors")
        
        # Summary
        elapsed = (datetime.now() - start_time).total_seconds()
        print("\n" + "="*60)
        print(f"[DONE] All syncs completed in {elapsed:.1f}s")
        print(f"   - FDB: {len(new_records)} new history records")
        print("   - IP Logs: Terminal status updated")
        print("   - Leaderboards: Calculated from Firebase")
        print("="*60 + "\n")
        
        # Update sync control status
        try:
            db.reference(f"{FB_PATHS.SYNC_CONTROL}/last_sync").set({
                "timestamp": datetime.now().isoformat(),
                "duration_seconds": round(elapsed, 2),
                "success": True
            })
        except:
            pass
        
    except Exception as e:
        print(f"\n[ERROR] Sync failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
