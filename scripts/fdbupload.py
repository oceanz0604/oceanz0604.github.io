"""
OceanZ Gaming Cafe - Optimized Firebird Database Upload Script

INCREMENTAL SYNC - Only uploads changed/new records since last sync.

Features:
- Tracks last synced record ID and timestamp
- Only uploads NEW history records (not all)
- Only updates CHANGED member profiles
- Pre-computes daily/monthly aggregations for faster JS queries
- Maintains sync metadata in Firebase

Run frequency: Every 30 minutes (Windows Task Scheduler)
"""

import os
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
    FB_PATHS, HISTORY_FIELD_MAP, FIREBIRD_USER, FIREBIRD_PASSWORD,
    normalize_terminal_name, get_short_terminal_name
)

# ==================== SYNC METADATA PATHS ====================

SYNC_META_PATH = "sync-meta"
LOCAL_SYNC_FILE = os.path.join(os.path.dirname(__file__), ".sync_state.json")

# ==================== UTILITIES ====================

def copy_fdb_file():
    """Copy Firebird database to working location."""
    os.makedirs(os.path.dirname(WORKING_FDB_PATH), exist_ok=True)
    try:
        shutil.copy2(SOURCE_FDB_PATH, WORKING_FDB_PATH)
        print(f"✅ Copied DB file")
    except Exception as e:
        print(f"❌ Failed to copy FDB file: {e}")
        raise


def init_firebase():
    """Initialize Firebase connection."""
    if firebase_admin._apps:
        return
    
    try:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
        print("✅ Firebase initialized")
    except Exception as e:
        print(f"❌ Firebase initialization failed: {e}")
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
        print(f"❌ Firebird connection failed: {e}")
        raise


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


# ==================== SYNC STATE MANAGEMENT ====================

def load_local_sync_state():
    """Load sync state from local file."""
    try:
        if os.path.exists(LOCAL_SYNC_FILE):
            with open(LOCAL_SYNC_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"⚠️ Could not load local sync state: {e}")
    
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
        print(f"⚠️ Could not save local sync state: {e}")


def get_firebase_sync_meta():
    """Get sync metadata from Firebase."""
    try:
        ref = db.reference(SYNC_META_PATH)
        return ref.get() or {}
    except Exception:
        return {}


def update_firebase_sync_meta(updates):
    """Update sync metadata in Firebase."""
    try:
        ref = db.reference(SYNC_META_PATH)
        ref.update(updates)
    except Exception as e:
        print(f"⚠️ Could not update Firebase sync meta: {e}")


# ==================== INCREMENTAL HISTORY SYNC ====================

def fetch_new_history_records(cursor, last_id):
    """Fetch only history records newer than last synced ID."""
    try:
        query = f"SELECT * FROM MEMBERSHISTORY WHERE ID > {last_id} ORDER BY ID ASC"
        cursor.execute(query)
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"📊 Found {len(rows)} NEW history records (after ID {last_id})")
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"❌ Failed to fetch new history: {e}")
        return []


def process_and_upload_history(records, sync_state):
    """Process and upload only new history records."""
    if not records:
        print("   No new history records to upload")
        return sync_state["last_history_id"]
    
    # Group by username
    by_user = defaultdict(dict)
    daily_aggregates = defaultdict(lambda: defaultdict(lambda: {"count": 0, "amount": 0}))
    max_id = sync_state["last_history_id"]
    
    for record in records:
        username = record.get("MEMBERS_USERNAME")
        if not username:
            continue
        
        username = str(username).strip().upper()
        
        # Skip invalid usernames
        if any(c in username for c in [".", "#", "$", "[", "]", "/"]):
            continue
        
        # Map fields
        date_val = record.get("TARIH") or record.get("DATE", "")
        time_val = record.get("SAAT") or record.get("TIME", "")
        charge_val = record.get("MIKTAR") or record.get("CHARGE", 0)
        balance_val = record.get("KALAN") or record.get("BALANCE", 0)
        
        record_id = record.get("ID", 0)
        max_id = max(max_id, record_id)
        
        # Parse date for timestamp
        date_str = str(date_val).split("T")[0] if date_val else ""
        time_str = str(time_val).split(".")[0] if time_val else ""
        
        try:
            if date_str and time_str:
                timestamp = f"{date_str}T{time_str}"
            else:
                timestamp = None
        except:
            timestamp = None
        
        # Normalize terminal
        terminal = record.get("TERMINALNAME", "")
        if terminal:
            terminal = normalize_terminal_name(terminal) or terminal
        
        # Build clean record
        clean_record = {
            "ID": record_id,
            "USERNAME": username,
            "DATE": date_str,
            "TIME": time_str,
            "TIMESTAMP": timestamp,
            "CHARGE": float(charge_val) if charge_val else 0,
            "BALANCE": float(balance_val) if balance_val else 0,
            "NOTE": record.get("NOTE", ""),
            "TERMINALNAME": terminal,
            "TERMINAL_SHORT": get_short_terminal_name(terminal),
            "USINGMIN": float(record.get("USINGMIN") or 0),
            "USINGSEC": float(record.get("USINGSEC") or 0),
            "DISCOUNTNOTE": record.get("DISCOUNTNOTE", ""),
        }
        
        by_user[username][str(record_id)] = clean_record
        
        # Aggregate for daily summary (only positive charges = recharges)
        if date_str and clean_record["CHARGE"] > 0:
            daily_aggregates[date_str][username]["count"] += 1
            daily_aggregates[date_str][username]["amount"] += clean_record["CHARGE"]
    
    # Upload incrementally using update() instead of set()
    uploaded = 0
    for username, records in by_user.items():
        try:
            ref = db.reference(f"{FB_PATHS.HISTORY}/{username}")
            ref.update(records)  # Merge, don't overwrite
            uploaded += len(records)
        except Exception as e:
            print(f"⚠️ Failed to upload history for {username}: {e}")
    
    print(f"   ✅ Uploaded {uploaded} history records for {len(by_user)} users")
    
    # Update daily aggregates
    if daily_aggregates:
        upload_daily_aggregates(daily_aggregates)
    
    return max_id


def upload_daily_aggregates(daily_data):
    """Upload/update daily summary aggregates."""
    for date_str, user_data in daily_data.items():
        try:
            ref = db.reference(f"daily-summary/{date_str}/by_member")
            
            # Get existing data
            existing = ref.get() or {}
            
            # Merge with new data
            for username, stats in user_data.items():
                if username in existing:
                    existing[username]["count"] = existing[username].get("count", 0) + stats["count"]
                    existing[username]["amount"] = existing[username].get("amount", 0) + stats["amount"]
                else:
                    existing[username] = stats
            
            ref.set(existing)
            
            # Update totals
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
            print(f"⚠️ Failed to update daily aggregate for {date_str}: {e}")
    
    print(f"   ✅ Updated daily aggregates for {len(daily_data)} dates")


# ==================== INCREMENTAL MEMBERS SYNC ====================

def fetch_all_members(cursor):
    """Fetch all members (we need all to detect changes)."""
    try:
        cursor.execute("SELECT * FROM MEMBERS")
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"❌ Failed to fetch members: {e}")
        return []


def process_and_upload_members(records, sync_state):
    """Upload only changed member profiles."""
    old_hashes = sync_state.get("member_hashes", {})
    new_hashes = {}
    
    members_to_update = {}
    members_array = []  # For legacy format
    
    for record in records:
        username = record.get("USERNAME")
        if not username or not isinstance(username, str):
            continue
        
        username = username.strip().upper()
        
        if any(c in username for c in [".", "#", "$", "[", "]", "/"]):
            continue
        
        # Build clean record
        clean_record = {
            "ID": record.get("ID"),
            "USERNAME": username,
            "BALANCE": float(record.get("BALANCE") or 0),
            "FIRSTNAME": record.get("FIRSTNAME", ""),
            "LASTNAME": record.get("LASTNAME", ""),
            "EMAIL": record.get("EMAIL", ""),
            "PHONE": record.get("PHONE", ""),
            "GROUPID": record.get("GROUPID"),
            "MEMBERSTATE": record.get("MEMBERSTATE", 0),
            "JOININGDATE": record.get("JOININGDATE"),
            "LASTCONNECTION": record.get("LASTCONNECTION"),
            "ISLOGIN": record.get("ISLOGIN", 0),
            "TIMEMINS": float(record.get("TIMEMINS") or 0),
            "TOTALUSEDMIN": float(record.get("TOTALUSEDMIN") or 0),
            "TOTALACTMINUTE": float(record.get("TOTALACTMINUTE") or 0),
            "TOTALPAID": float(record.get("TOTALPAID") or 0),
        }
        
        members_array.append(clean_record)
        
        # Check if changed
        record_hash = get_record_hash(clean_record)
        new_hashes[username] = record_hash
        
        if old_hashes.get(username) != record_hash:
            members_to_update[username] = clean_record
    
    # Upload only changed members
    if members_to_update:
        print(f"📊 Found {len(members_to_update)} CHANGED members (out of {len(records)})")
        
        for username, data in members_to_update.items():
            try:
                db.reference(f"{FB_PATHS.MEMBERS}/{username}").set(data)
            except Exception as e:
                print(f"⚠️ Failed to upload member {username}: {e}")
        
        print(f"   ✅ Updated {len(members_to_update)} member profiles")
    else:
        print(f"   No member changes detected")
    
    # Always update legacy array (for backward compatibility)
    # But only if there were changes
    if members_to_update:
        try:
            db.reference(FB_PATHS.LEGACY_MEMBERS).set(members_array)
            print(f"   ✅ Updated legacy members array ({len(members_array)} members)")
        except Exception as e:
            print(f"⚠️ Failed to update legacy members: {e}")
    
    return new_hashes


# ==================== SESSIONS SYNC ====================

def fetch_recent_sessions(cursor, hours=2):
    """Fetch only sessions from the last N hours."""
    try:
        # Get sessions modified in the last N hours
        # Firebird date math: CURRENT_TIMESTAMP - N/24 for hours
        query = f"""
            SELECT * FROM SESSIONS 
            WHERE ENDPOINT IS NULL 
               OR ENDPOINT > CURRENT_TIMESTAMP - {hours}/24.0
            ORDER BY ID DESC
        """
        cursor.execute(query)
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"📊 Found {len(rows)} recent sessions (last {hours} hours)")
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"❌ Failed to fetch sessions: {e}")
        return []


def process_and_upload_sessions(records):
    """Upload recent sessions grouped by member."""
    by_member = defaultdict(dict)
    guest_sessions = {}
    
    for record in records:
        member_id = str(record.get("MEMBERID", 0))
        session_id = str(record.get("ID"))
        
        # Normalize terminal
        terminal = record.get("TERMINALNAME", "")
        if terminal:
            record["TERMINALNAME"] = normalize_terminal_name(terminal) or terminal
            record["TERMINAL_SHORT"] = get_short_terminal_name(terminal)
        
        if member_id == "0":
            guest_sessions[session_id] = record
        else:
            by_member[member_id][session_id] = record
    
    # Upload using update() to merge
    for member_id, sessions in by_member.items():
        try:
            ref = db.reference(f"{FB_PATHS.SESSIONS_BY_MEMBER}/{member_id}")
            ref.update(sessions)
        except Exception as e:
            print(f"⚠️ Failed to upload sessions for member {member_id}: {e}")
    
    if guest_sessions:
        try:
            db.reference(f"{FB_PATHS.SESSIONS_BY_MEMBER}/guest").update(guest_sessions)
        except Exception:
            pass
    
    total = sum(len(s) for s in by_member.values()) + len(guest_sessions)
    print(f"   ✅ Updated {total} sessions for {len(by_member)} members")


# ==================== LEADERBOARD PRE-COMPUTATION ====================

def compute_and_upload_leaderboards(cursor):
    """Pre-compute leaderboards for faster JS access."""
    try:
        # All-time leaderboard from MEMBERS table
        cursor.execute("""
            SELECT USERNAME, TOTALACTMINUTE, TOTALPAID, RECDATE
            FROM MEMBERS 
            WHERE TOTALACTMINUTE > 0
            ORDER BY TOTALACTMINUTE DESC
        """)
        
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        
        all_time = []
        for i, row in enumerate(rows[:50]):  # Top 50
            record = dict(zip(columns, [convert_value(v) for v in row]))
            all_time.append({
                "rank": i + 1,
                "username": record["USERNAME"],
                "total_minutes": record["TOTALACTMINUTE"] or 0,
                "total_hours": round((record["TOTALACTMINUTE"] or 0) / 60, 1),
                "total_paid": record["TOTALPAID"] or 0,
                "member_since": record["RECDATE"]
            })
        
        db.reference(f"{FB_PATHS.LEADERBOARDS}/all-time").set(all_time)
        print(f"   ✅ Updated all-time leaderboard ({len(all_time)} entries)")
        
    except Exception as e:
        print(f"⚠️ Failed to compute leaderboards: {e}")


# ==================== MAIN ====================

def main():
    """Main incremental sync routine."""
    start_time = datetime.now()
    
    print("\n" + "="*60)
    print("🎮 OceanZ PanCafe INCREMENTAL Sync")
    print(f"   Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60 + "\n")
    
    try:
        copy_fdb_file()
        init_firebase()
        conn = connect_to_firebird()
        cursor = conn.cursor()
        
        # Load sync state
        sync_state = load_local_sync_state()
        last_sync = sync_state.get("last_sync_time")
        if last_sync:
            print(f"📅 Last sync: {last_sync}")
        else:
            print("📅 First sync - will upload all data")
        
        # 1. Incremental History Sync
        print("\n📊 Processing HISTORY (incremental)...")
        new_records = fetch_new_history_records(cursor, sync_state.get("last_history_id", 0))
        new_max_id = process_and_upload_history(new_records, sync_state)
        sync_state["last_history_id"] = new_max_id
        
        # 2. Members Sync (with change detection)
        print("\n📊 Processing MEMBERS (change detection)...")
        members = fetch_all_members(cursor)
        new_hashes = process_and_upload_members(members, sync_state)
        sync_state["member_hashes"] = new_hashes
        
        # 3. Recent Sessions Sync
        print("\n📊 Processing SESSIONS (recent only)...")
        sessions = fetch_recent_sessions(cursor, hours=2)
        process_and_upload_sessions(sessions)
        
        # 4. Pre-compute Leaderboards
        print("\n📊 Computing LEADERBOARDS...")
        compute_and_upload_leaderboards(cursor)
        
        # Save sync state
        sync_state["last_sync_time"] = start_time.isoformat()
        save_local_sync_state(sync_state)
        
        # Update Firebase sync meta
        update_firebase_sync_meta({
            "last_fdb_sync": start_time.isoformat(),
            "last_history_id": new_max_id,
            "records_synced": len(new_records)
        })
        
        conn.close()
        
        elapsed = (datetime.now() - start_time).total_seconds()
        print("\n" + "="*60)
        print(f"🎉 Sync completed in {elapsed:.1f}s")
        print(f"   New history records: {len(new_records)}")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n❌ Sync failed: {e}")
        raise


if __name__ == "__main__":
    main()
