import os
import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime, timedelta
from collections import defaultdict

# === CONFIG ===
FIREBASE_CREDENTIALS_PATH = r"C:\Firebase\fbcreds.json"
FIREBASE_DB_URL = "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app/"
IPLOG_BASE_PATH = r"C:\Users\decrypter\Downloads\iplogs\iplogs"
SESSION_RETENTION_DAYS = 3


# === FIREBASE INITIALIZATION ===
def initialize_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


# === CLEANUP OLD SESSIONS ===
def delete_old_sessions():
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
                print(f"Deleted old session: {key}")
        except Exception as e:
            print(f"Error deleting session {key}: {e}")


# === READ LOG FILE ===
def read_log_file():
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
    raise FileNotFoundError("No log file found for today or yesterday.")


# === PARSE LOG DATA ===
def parse_logs(log_lines):
    entries = []
    for line in log_lines:
        parts = line.strip(";\n").split(";")
        if len(parts) != 6:
            continue
        status, terminal, mac, ip, date_str, time_str = parts
        dt_str = f"{date_str} {time_str}"
        try:
            dt = datetime.strptime(dt_str, "%d.%m.%Y %H:%M:%S")
        except ValueError:
            continue
        entries.append({
            "status": status,
            "terminal": terminal,
            "mac": mac,
            "ip": ip,
            "datetime": dt
        })
    entries.sort(key=lambda x: x["datetime"])  # sort chronologically
    return entries


# === PROCESS ENTRIES INTO SESSIONS & STATUS ===
def process_entries(entries):
    sessions = []
    open_sessions = defaultdict(list)
    terminal_status = {}

    for entry in entries:
        key = entry["terminal"]
        if entry["status"] == "Açildi":
            open_sessions[key] = [entry]  # keep only latest Açildi
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

    now = datetime.now()

    # Add ongoing sessions
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


# === FINALIZE TERMINAL STATUS MAP ===
def build_terminal_status_map(sessions, existing_status):
    status_map = dict(existing_status)  # start with known terminals

    now = datetime.now().isoformat()
    all_terminals = (
        [f"CT-ROOM-{i}" for i in range(1, 8)] +
        [f"T-ROOM-{i}" for i in range(1, 8)] +
        ["PS", "XBOX ONE X"]
    )

    # Closed sessions
    for s in sessions:
        if not s.get("active"):
            status_map[s["terminal"]] = {
                "status": "available",
                "mac": s["mac"],
                "ip": s["ip"],
                "last_updated": s["end"]
            }

    # Active sessions
    for s in sessions:
        if s.get("active"):
            status_map[s["terminal"]] = {
                "status": "occupied",
                "mac": s["mac"],
                "ip": s["ip"],
                "last_updated": s["end"]
            }

    # Fill missing terminals as available
    for terminal in all_terminals:
        if terminal not in status_map:
            status_map[terminal] = {
                "status": "available",
                "mac": None,
                "ip": None,
                "last_updated": now
            }

    return status_map


# === PUSH TO FIREBASE ===
def upload_to_firebase(sessions, terminal_status):
    for session in sessions:
        session_id = f"{session['terminal'].replace('/', '_')}__{session['start'].replace(':', '-').replace('.', '-')}"
        db.reference(f"sessions/{session_id}").set(session)

    for terminal, data in terminal_status.items():
        db.reference(f"status/{terminal}").set(data)


# === MAIN FLOW ===
def main():
    try:
        initialize_firebase()
        delete_old_sessions()
        log_lines = read_log_file()
        entries = parse_logs(log_lines)
        sessions, raw_status = process_entries(entries)
        terminal_status = build_terminal_status_map(sessions, raw_status)
        upload_to_firebase(sessions, terminal_status)
        print("Firebase updated successfully.")
    except Exception as e:
        print(f"Error occurred: {e}")


if __name__ == "__main__":
    main()
