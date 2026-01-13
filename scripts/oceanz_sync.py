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
        
        # Map FDB fields to our standard names
        # FDB has: NAME, LASTNAME, BAKIYE, ACCSTATUS, LOGIN, RECDATE, LLOGDATE, TOTALBAKIYE, TOTALACTMINUTE
        clean_record = {
            "USERNAME": username,
            "PASSWORD": record.get("PASSWORD") or "",  # Required for member login
            "BALANCE": float(record.get("BAKIYE") or 0),  # FDB: BAKIYE
            "FIRSTNAME": record.get("NAME") or "",  # FDB: NAME (not FIRSTNAME!)
            "LASTNAME": record.get("LASTNAME") or "",
            "EMAIL": record.get("EMAIL") or "",
            "PHONE": record.get("PHONE") or record.get("GSM") or "",  # FDB has both PHONE and GSM
            "MEMBERSTATE": int(record.get("ACCSTATUS") or 0),  # FDB: ACCSTATUS
            "ISLOGIN": int(record.get("LOGIN") or 0),  # FDB: LOGIN
            "TOTALACTMINUTE": int(record.get("TOTALACTMINUTE") or 0),  # Total active minutes
            "TOTALBAKIYE": float(record.get("TOTALBAKIYE") or 0),  # Total balance/paid
        }
        
        if record.get("ID") is not None:
            clean_record["ID"] = record.get("ID")
        if record.get("PRICETYPE") is not None:
            clean_record["PRICETYPE"] = record.get("PRICETYPE")  # Pricing group
        if record.get("ACCTYPE") is not None:
            clean_record["ACCTYPE"] = record.get("ACCTYPE")  # Account type
        if record.get("RECDATE"):
            clean_record["RECDATE"] = record.get("RECDATE")  # Registration date
        if record.get("LLOGDATE"):
            clean_record["LASTLOGIN"] = record.get("LLOGDATE")  # FDB: LLOGDATE (Last Login Date)
        if record.get("AVAILBONUS") is not None:
            clean_record["AVAILBONUS"] = float(record.get("AVAILBONUS") or 0)  # Available bonus
        
        members_array.append(clean_record)
        record_hash = get_record_hash(clean_record)
        new_hashes[username] = record_hash
        
        if old_hashes.get(username) != record_hash:
            members_to_update[username] = clean_record
    
    if members_to_update:
        print(f"[DATA] Found {len(members_to_update)} CHANGED members (out of {len(records)})")
        
        # Update legacy members array (used by frontend for search, analytics, etc.)
        try:
            db.reference(FB_PATHS.LEGACY_MEMBERS).set(members_array)
            print(f"   [OK] Updated members array ({len(members_array)} members)")
        except Exception as e:
            print(f"[WARN] Failed to update members: {e}")
    else:
        print("   No member changes detected")
    
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
    """Fetch real-time terminal status directly from FDB TERMINALS table."""
    try:
        cursor.execute("""
            SELECT 
                ID, NAME, TERMINALTYPE, TERMINALSTATUS, MEMBERID,
                STARTTIME, STARTDATE, TIMERMINUTE, MAC,
                OPENADMINNAME, SUREPARA, SESSIONPAUSED
            FROM TERMINALS
            ORDER BY NAME
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
        print("[STEP 1/4] FDB Database Sync")
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
        
        # ========== 2. TERMINAL STATUS (from FDB TERMINALS table) ==========
        print("\n" + "="*60)
        print("[STEP 2/4] Terminal Status Sync (from FDB)")
        print("="*60)
        
        # Re-open FDB connection for terminal status
        copy_fdb_file()
        conn = connect_to_firebird()
        cursor = conn.cursor()
        
        terminals = fetch_terminals_from_fdb(cursor)
        process_and_upload_terminal_status(terminals)
        
        db.reference(f"{FB_PATHS.SYNC_META}/terminals").update({
            "last_sync": datetime.now().isoformat(),
            "status": "ok",
            "source": "fdb_terminals_table"
        })
        
        print("\n[OK] Terminal status sync completed")
        
        # ========== 3. CASH REGISTER (from FDB KASAHAR table) ==========
        print("\n" + "="*60)
        print("[STEP 3/4] Cash Register Sync (Revenue)")
        print("="*60)
        
        kasahar_records = fetch_kasahar_records(cursor, days=7)
        process_and_upload_kasahar(kasahar_records)
        
        db.reference(f"{FB_PATHS.SYNC_META}/cash_register").update({
            "last_sync": datetime.now().isoformat(),
            "status": "ok",
            "days_synced": 7
        })
        
        conn.close()
        print("\n[OK] Cash register sync completed")
        
        # ========== 4. LEADERBOARDS ==========
        print("\n" + "="*60)
        print("[STEP 4/4] Leaderboard Calculation")
        print("="*60)
        
        if calculate_leaderboards_from_firebase():
            print("\n[OK] Leaderboard calculation completed")
        else:
            print("\n[WARN] Leaderboard calculation had errors")
        
        # Summary
        elapsed = (datetime.now() - start_time).total_seconds()
        print("\n" + "="*60)
        print(f"[DONE] All syncs completed in {elapsed:.1f}s")
        print(f"   - FDB History: {len(new_records)} new records")
        print(f"   - Terminals: {len(terminals)} PCs (from FDB TERMINALS table)")
        print(f"   - Cash Register: {len(kasahar_records)} transactions (7 days)")
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
