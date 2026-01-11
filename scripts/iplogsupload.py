"""
OceanZ Gaming Cafe - IP Logs Upload Script (OPTIMIZED)

INCREMENTAL SYNC - Only processes new log entries since last sync.

Features:
- Tracks last processed log line position
- Only uploads changed terminal status
- Caches previous status for comparison
- Runs every 2 minutes efficiently

Firebase Structure:
  /sessions/{SESSION_ID} - Individual sessions with active flag
  /terminal-status/{TERMINAL_NAME} - Current terminal status
  /sync-meta/iplogs - Sync metadata
"""

import os
import json
import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime, timedelta
from collections import defaultdict

# Import shared config
from config import (
    FIREBASE_CRED_PATH, FIREBASE_DB_URL, IPLOG_BASE_PATH,
    FB_PATHS, ALL_TERMINALS, SESSION_RETENTION_DAYS,
    normalize_terminal_name
)

# ==================== LOCAL STATE FILE ====================

LOCAL_STATE_FILE = os.path.join(os.path.dirname(__file__), ".iplogs_state.json")

def load_local_state():
    """Load sync state from local file."""
    try:
        if os.path.exists(LOCAL_STATE_FILE):
            with open(LOCAL_STATE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    
    return {
        "last_file": None,
        "last_position": 0,
        "last_line_count": 0,
        "terminal_status_cache": {},
        "open_sessions": {}
    }


def save_local_state(state):
    """Save sync state to local file."""
    try:
        with open(LOCAL_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2, default=str)
    except Exception as e:
        print(f"⚠️ Could not save local state: {e}")


# ==================== FIREBASE ====================

def initialize_firebase():
    """Initialize Firebase connection."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


def cleanup_old_sessions_periodic():
    """
    Clean up old sessions - run less frequently (every 10th run).
    Uses a counter stored in local state.
    """
    state = load_local_state()
    cleanup_counter = state.get("cleanup_counter", 0) + 1
    state["cleanup_counter"] = cleanup_counter
    save_local_state(state)
    
    # Only run cleanup every 10 runs (20 minutes at 2-min intervals)
    if cleanup_counter % 10 != 0:
        return
    
    print("🧹 Running periodic cleanup...")
    
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
            print(f"   🗑️ Deleted {deleted} old sessions")
            
    except Exception as e:
        print(f"⚠️ Cleanup error: {e}")


# ==================== LOG READING ====================

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
    """
    Read only NEW log lines since last sync.
    Returns (new_lines, current_file, current_line_count)
    """
    path, fname, date_key = get_log_file_info()
    
    if not path:
        print("⚠️ No log file found")
        return [], None, 0
    
    last_file = state.get("last_file")
    last_position = state.get("last_position", 0)
    last_line_count = state.get("last_line_count", 0)
    
    # Read current file
    try:
        with open(path, "r", encoding="windows-1254") as f:
            all_lines = f.readlines()
    except Exception as e:
        print(f"❌ Error reading log file: {e}")
        return [], fname, 0
    
    current_line_count = len(all_lines)
    
    # Determine which lines are new
    if last_file != fname:
        # New day = new file, read all
        print(f"📄 New log file: {fname} ({current_line_count} lines)")
        new_lines = all_lines
        # But also process any pending open sessions from yesterday
    elif current_line_count > last_line_count:
        # Same file, new lines appended
        new_lines = all_lines[last_line_count:]
        print(f"📄 Reading {len(new_lines)} new lines (was {last_line_count}, now {current_line_count})")
    else:
        # No new lines
        print(f"   No new log entries")
        return [], fname, current_line_count
    
    return new_lines, fname, current_line_count


# ==================== PARSING ====================

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
    
    # Sort by time (important for correct session matching)
    entries.sort(key=lambda x: x["datetime"])
    return entries


# ==================== SESSION PROCESSING ====================

def process_entries_incremental(entries, state):
    """
    Process log entries incrementally, maintaining open session state.
    
    Status meanings from PanCafe:
        - "Açildi" = Opened (session start)
        - "Kapandi" = Closed (session end)
    """
    # Restore open sessions from state
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
            # Session opened
            open_sessions[terminal] = entry
            terminal_status[terminal] = {
                "status": "occupied",
                "mac": entry["mac"],
                "ip": entry["ip"],
                "session_start": entry["datetime"].isoformat(),
                "last_updated": entry["datetime"].isoformat()
            }
            
        elif entry["status"] == "Kapandi":
            # Session closed
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
    
    # Calculate current active sessions
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
    
    # Serialize open sessions for state storage
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
                "mac": None,
                "ip": None,
                "last_updated": now
            }
    
    return status_map


# ==================== UPLOAD ====================

def upload_sessions(completed_sessions):
    """Upload only newly completed sessions."""
    if not completed_sessions:
        return
    
    print(f"   📤 Uploading {len(completed_sessions)} completed sessions")
    
    for session in completed_sessions:
        session_id = f"{session['terminal'].replace(' ', '_')}__{session['start'].replace(':', '-').replace('.', '-')}"
        try:
            db.reference(f"{FB_PATHS.SESSIONS}/{session_id}").set(session)
        except Exception as e:
            print(f"⚠️ Failed to upload session: {e}")


def upload_terminal_status(terminal_status, old_cache):
    """Upload only changed terminal statuses."""
    changes = 0
    
    for terminal, data in terminal_status.items():
        old_data = old_cache.get(terminal, {})
        
        # Check if status actually changed
        if (old_data.get("status") != data.get("status") or 
            old_data.get("session_start") != data.get("session_start")):
            
            safe_key = terminal.replace(" ", "_").replace("/", "_")
            
            try:
                db.reference(f"{FB_PATHS.TERMINAL_STATUS}/{safe_key}").set(data)
                db.reference(f"{FB_PATHS.LEGACY_STATUS}/{terminal}").set(data)
                changes += 1
            except Exception as e:
                print(f"⚠️ Failed to update {terminal}: {e}")
    
    if changes > 0:
        print(f"   📤 Updated {changes} terminal statuses")
    else:
        print(f"   No terminal status changes")


def update_sync_meta():
    """Update sync metadata in Firebase."""
    try:
        db.reference(f"{FB_PATHS.SYNC_META}/iplogs").update({
            "last_sync": datetime.now().isoformat(),
            "status": "ok"
        })
    except Exception:
        pass


# ==================== MAIN ====================

def main():
    """Main incremental sync routine."""
    start_time = datetime.now()
    
    print(f"\n⏱️  IPLogs Sync @ {start_time.strftime('%H:%M:%S')}")
    
    try:
        initialize_firebase()
        
        # Load previous state
        state = load_local_state()
        old_cache = dict(state.get("terminal_status_cache", {}))
        
        # Periodic cleanup (every 10th run)
        cleanup_old_sessions_periodic()
        
        # Read new log lines
        new_lines, current_file, line_count = read_new_log_lines(state)
        
        if new_lines:
            # Parse and process
            entries = parse_log_lines(new_lines)
            
            if entries:
                completed, active, terminal_status, open_sessions = process_entries_incremental(entries, state)
                terminal_status = build_complete_terminal_status(terminal_status)
                
                # Upload changes
                upload_sessions(completed)
                upload_terminal_status(terminal_status, old_cache)
                
                # Update state
                state["terminal_status_cache"] = terminal_status
                state["open_sessions"] = open_sessions
                
                # Print summary
                occupied = sum(1 for t in terminal_status.values() if t["status"] == "occupied")
                print(f"   📊 Active: {len(active)} | Completed: {len(completed)} | Occupied: {occupied}/{len(ALL_TERMINALS)}")
        
        # Update file tracking
        state["last_file"] = current_file
        state["last_line_count"] = line_count
        state["last_sync"] = start_time.isoformat()
        
        save_local_state(state)
        update_sync_meta()
        
        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"   ✅ Done in {elapsed:.2f}s\n")
        
    except Exception as e:
        print(f"   ❌ Error: {e}\n")


if __name__ == "__main__":
    main()
