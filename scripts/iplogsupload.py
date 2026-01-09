"""
OceanZ Gaming Cafe - IP Logs Upload Script

Parses terminal IP logs to track:
- Active/closed sessions
- Terminal availability status
"""

import os
import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime, timedelta
from collections import defaultdict

# ==================== CONFIGURATION ====================

FIREBASE_CREDENTIALS_PATH = r"C:\Firebase\fbcreds.json"
FIREBASE_DB_URL = "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app/"
IPLOG_BASE_PATH = r"C:\Users\decrypter\Downloads\iplogs\iplogs"
SESSION_RETENTION_DAYS = 3

ALL_TERMINALS = (
    [f"CT-ROOM-{i}" for i in range(1, 8)] +
    [f"T-ROOM-{i}" for i in range(1, 8)] +
    ["PS", "XBOX ONE X"]
)

# ==================== FIREBASE ====================

def initialize_firebase():
    """Initialize Firebase connection."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


def delete_old_sessions():
    """Remove sessions older than retention period."""
    sessions_ref = db.reference("sessions")
    all_sessions = sessions_ref.get()

    if not all_sessions:
        return

    now = datetime.now()
    cutoff = now - timedelta(days=SESSION_RETENTION_DAYS)

    for key, session in all_sessions.items():
        try:
            session_start = datetime.fromisoformat(session["start"])
            if session_start < cutoff:
                sessions_ref.child(key).delete()
                print(f"🗑️ Deleted old session: {key}")
        except Exception as e:
            print(f"⚠️ Error deleting session {key}: {e}")

# ==================== LOG PARSING ====================

def read_log_file():
    """Read today's or yesterday's log file."""
    today = datetime.now()
    yesterday = today - timedelta(days=1)

    filenames = [
        f"Log_{today.strftime('%d%m%Y')}.csv",
        f"Log_{yesterday.strftime('%d%m%Y')}.csv"
    ]

    for fname in filenames:
        path = os.path.join(IPLOG_BASE_PATH, fname)
        if os.path.isfile(path):
            with open(path, "r", encoding="windows-1254") as f:
                return f.readlines()
    
    raise FileNotFoundError("❌ No log file found for today or yesterday.")


def parse_logs(log_lines):
    """Parse log entries into structured data."""
    entries = []
    for line in log_lines:
        parts = line.strip(";\n").split(";")
        if len(parts) != 6:
            continue
        
        status, terminal, mac, ip, date_str, time_str = parts
        try:
            dt = datetime.strptime(f"{date_str} {time_str}", "%d.%m.%Y %H:%M:%S")
        except ValueError:
            continue
        
        entries.append({
            "status": status,
            "terminal": terminal,
            "mac": mac,
            "ip": ip,
            "datetime": dt
        })
    
    entries.sort(key=lambda x: x["datetime"])
    return entries

# ==================== SESSION PROCESSING ====================

def process_entries(entries):
    """Process log entries into sessions and terminal status."""
    sessions = []
    open_sessions = defaultdict(list)
    terminal_status = {}

    for entry in entries:
        key = entry["terminal"]
        
        if entry["status"] == "Açildi":
            open_sessions[key] = [entry]
        elif entry["status"] == "Kapandi" and key in open_sessions and open_sessions[key]:
            start = open_sessions[key].pop(0)
            duration = (entry["datetime"] - start["datetime"]).total_seconds() / 60
            
            sessions.append({
                "terminal": key,
                "mac": start["mac"],
                "ip": start["ip"],
                "start": start["datetime"].isoformat(),
                "end": entry["datetime"].isoformat(),
                "duration_minutes": round(duration, 2),
                "active": False
            })
            
            terminal_status[key] = {
                "status": "available",
                "mac": entry["mac"],
                "ip": entry["ip"],
                "last_updated": entry["datetime"].isoformat()
            }

    # Add ongoing sessions
    now = datetime.now()
    for terminal, starts in open_sessions.items():
        for start in starts:
            duration = (now - start["datetime"]).total_seconds() / 60
            sessions.append({
                "terminal": terminal,
                "mac": start["mac"],
                "ip": start["ip"],
                "start": start["datetime"].isoformat(),
                "end": now.isoformat(),
                "duration_minutes": round(duration, 2),
                "active": True
            })
            terminal_status[terminal] = {
                "status": "occupied",
                "mac": start["mac"],
                "ip": start["ip"],
                "last_updated": now.isoformat()
            }

    return sessions, terminal_status


def build_terminal_status_map(sessions, existing_status):
    """Build complete terminal status map."""
    status_map = dict(existing_status)
    now = datetime.now().isoformat()

    # Update from closed sessions
    for s in sessions:
        if not s.get("active"):
            status_map[s["terminal"]] = {
                "status": "available",
                "mac": s["mac"],
                "ip": s["ip"],
                "last_updated": s["end"]
            }

    # Update from active sessions
    for s in sessions:
        if s.get("active"):
            status_map[s["terminal"]] = {
                "status": "occupied",
                "mac": s["mac"],
                "ip": s["ip"],
                "last_updated": s["end"]
            }

    # Fill missing terminals as available
    for terminal in ALL_TERMINALS:
        if terminal not in status_map:
            status_map[terminal] = {
                "status": "available",
                "mac": None,
                "ip": None,
                "last_updated": now
            }

    return status_map

# ==================== UPLOAD ====================

def upload_to_firebase(sessions, terminal_status):
    """Upload sessions and status to Firebase."""
    for session in sessions:
        session_id = f"{session['terminal'].replace('/', '_')}__{session['start'].replace(':', '-').replace('.', '-')}"
        db.reference(f"sessions/{session_id}").set(session)

    for terminal, data in terminal_status.items():
        db.reference(f"status/{terminal}").set(data)

# ==================== MAIN ====================

def main():
    try:
        initialize_firebase()
        delete_old_sessions()
        
        log_lines = read_log_file()
        entries = parse_logs(log_lines)
        sessions, raw_status = process_entries(entries)
        terminal_status = build_terminal_status_map(sessions, raw_status)
        
        upload_to_firebase(sessions, terminal_status)
        print("✅ Firebase updated successfully.")
        
    except Exception as e:
        print(f"❌ Error occurred: {e}")


if __name__ == "__main__":
    main()

