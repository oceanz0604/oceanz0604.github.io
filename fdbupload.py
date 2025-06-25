import os
import shutil
import fdb
import firebase_admin
from datetime import datetime, date, time
from collections import defaultdict
from firebase_admin import credentials, db

# ---------------- CONFIGURATION ----------------
SOURCE_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB.dat"
FDB_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB_copy.FDB"
FIREBASE_CRED_PATH = r"C:\Firebase\fbcreds.json"
FIREBASE_DB_URL = "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app"
# ------------------------------------------------


def copy_fdb_file():
    """Copies the Firebird database file to a temporary working copy."""
    os.makedirs(os.path.dirname(FDB_PATH), exist_ok=True)
    try:
        shutil.copy2(SOURCE_PATH, FDB_PATH)
        print(f"Copied DB file to: {FDB_PATH}")
    except Exception as e:
        print(f"Failed to copy FDB file: {e}")
        raise


def init_firebase():
    """Initializes Firebase connection using a service account."""
    try:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DB_URL})
        print("Firebase initialized.")
    except Exception as e:
        print(f"Firebase initialization failed: {e}")
        raise


def connect_to_firebird():
    """Connects to the Firebird database and returns the connection."""
    try:
        conn = fdb.connect(
            dsn=FDB_PATH,
            user="SYSDBA",
            password="masterkey"
        )
        print("Connected to Firebird.")
        return conn
    except Exception as e:
        print(f"Firebird connection failed: {e}")
        raise


def convert_value(val):
    """Converts date/time objects to ISO format."""
    return val.isoformat() if isinstance(val, (date, datetime, time)) else val


def fetch_table(cursor, table_name):
    """Fetches all records from the specified Firebird table."""
    try:
        cursor.execute(f"SELECT * FROM {table_name}")
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        print(f"Retrieved {len(rows)} rows from {table_name}")
        return [dict(zip(columns, [convert_value(v) for v in row])) for row in rows]
    except Exception as e:
        print(f"Failed to fetch table {table_name}: {e}")
        raise


def parse_datetime(date_str, time_str):
    """Parses DATE and TIME fields to a datetime object."""
    try:
        return datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S.%f")
    except ValueError:
        return datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")


def process_member_history(records):
    """Transforms and groups MEMBERHISTORY records by username."""
    history_by_user = defaultdict(list)

    for record in records:
        username = record.get('MEMBERS_USERNAME')
        if not username:
            continue

        # Rename fields for clarity
        record["TIME"] = record.pop("SAAT", "")
        record["DATE"] = record.pop("TARIH", "")
        record["BALANCE"] = record.pop("KALAN", "")
        record["CHARGE"] = record.pop("MIKTAR", "")

        history_by_user[username].append(record)

    # Sort records per user by datetime descending
    for uname, recs in history_by_user.items():
        recs.sort(key=lambda r: parse_datetime(r['DATE'], r['TIME']), reverse=True)

    return history_by_user


def upload_user_history(username, records):
    """Uploads individual user's history to Firebase."""
    print(f"Uploading {len(records)} records for user: {username}")
    if '.' in username:
        print("Invalid character found, skipping this user")
        return
    rec = {}
    for r in records:
        record_id = str(r.get("ID") or f"{r['DATE']}_{r['TIME']}")
        rec.update({record_id: r})
    db.reference(f"history/{username}").set(rec)


def upload_table_to_firebase(table_name, records):
    """Uploads a full table to Firebase."""
    print(f"Uploading {len(records)} records from table: {table_name}")
    db.reference(f"fdb/{table_name}").set(records)
    print(f"Uploaded to /fdb/{table_name}")


def main():
    try:
        copy_fdb_file()
        init_firebase()
        conn = connect_to_firebird()
        cursor = conn.cursor()

        # 1. Upload MEMBER HISTORY
        try:
            history_raw = fetch_table(cursor, "MEMBERSHISTORY")
            history_data = process_member_history(history_raw)
            for user, records in history_data.items():
                upload_user_history(user, records)
        except Exception as e:
            print(f"Failed to process MEMBERSHISTORY: {e}")

        # 2. Upload MEMBERS
        try:
            members = fetch_table(cursor, "MEMBERS")
            upload_table_to_firebase("MEMBERS", members)
        except Exception as e:
            print(f"Failed to process MEMBERS: {e}")

        print("All data synced successfully.")

    except Exception as e:
        print(f"Sync failed: {e}")


if __name__ == "__main__":
    main()
