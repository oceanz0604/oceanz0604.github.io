#!/usr/bin/env python3
"""
OceanZ - Firebird Database Inspector

This script extracts all metadata from the PanCafe Firebird database:
- All table names
- Column names, types, and constraints for each table
- Sample data from key tables

Run this on the Counter PC and share the output.
"""

import fdb
import json
from datetime import datetime, date, time
from config import WORKING_FDB_PATH, SOURCE_FDB_PATH, FIREBIRD_USER, FIREBIRD_PASSWORD
import shutil
import os

def convert_value(val):
    """Convert values to JSON-serializable format."""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, time):
        return val.isoformat()
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="ignore")
    return val

def get_all_tables(cursor):
    """Get all user tables (excluding system tables)."""
    cursor.execute("""
        SELECT RDB$RELATION_NAME 
        FROM RDB$RELATIONS 
        WHERE RDB$SYSTEM_FLAG = 0 
          AND RDB$VIEW_BLF IS NULL
        ORDER BY RDB$RELATION_NAME
    """)
    return [row[0].strip() for row in cursor.fetchall()]

def get_table_columns(cursor, table_name):
    """Get column details for a table."""
    cursor.execute(f"""
        SELECT 
            rf.RDB$FIELD_NAME as COLUMN_NAME,
            f.RDB$FIELD_TYPE as FIELD_TYPE,
            f.RDB$FIELD_LENGTH as FIELD_LENGTH,
            f.RDB$FIELD_PRECISION as FIELD_PRECISION,
            f.RDB$FIELD_SCALE as FIELD_SCALE,
            rf.RDB$NULL_FLAG as NOT_NULL,
            rf.RDB$DEFAULT_SOURCE as DEFAULT_VALUE
        FROM RDB$RELATION_FIELDS rf
        JOIN RDB$FIELDS f ON rf.RDB$FIELD_SOURCE = f.RDB$FIELD_NAME
        WHERE rf.RDB$RELATION_NAME = '{table_name}'
        ORDER BY rf.RDB$FIELD_POSITION
    """)
    
    # Firebird type codes
    type_map = {
        7: "SMALLINT",
        8: "INTEGER",
        10: "FLOAT",
        12: "DATE",
        13: "TIME",
        14: "CHAR",
        16: "BIGINT",
        27: "DOUBLE",
        35: "TIMESTAMP",
        37: "VARCHAR",
        261: "BLOB",
    }
    
    columns = []
    for row in cursor.fetchall():
        col_name = row[0].strip() if row[0] else ""
        field_type = row[1]
        field_length = row[2]
        field_precision = row[3]
        field_scale = row[4]
        not_null = row[5] == 1
        default_val = row[6].strip() if row[6] else None
        
        type_name = type_map.get(field_type, f"UNKNOWN({field_type})")
        
        # Add length/precision info
        if field_type in (14, 37):  # CHAR, VARCHAR
            type_name = f"{type_name}({field_length})"
        elif field_type == 16 and field_scale:  # NUMERIC
            type_name = f"NUMERIC({field_precision},{abs(field_scale)})"
        
        columns.append({
            "name": col_name,
            "type": type_name,
            "nullable": not not_null,
            "default": default_val
        })
    
    return columns

def get_primary_key(cursor, table_name):
    """Get primary key columns for a table."""
    try:
        cursor.execute(f"""
            SELECT i.RDB$FIELD_NAME
            FROM RDB$RELATION_CONSTRAINTS rc
            JOIN RDB$INDEX_SEGMENTS i ON rc.RDB$INDEX_NAME = i.RDB$INDEX_NAME
            WHERE rc.RDB$RELATION_NAME = '{table_name}'
              AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
        """)
        return [row[0].strip() for row in cursor.fetchall()]
    except:
        return []

def get_row_count(cursor, table_name):
    """Get approximate row count."""
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        return cursor.fetchone()[0]
    except:
        return -1

def get_sample_data(cursor, table_name, limit=3):
    """Get sample rows from a table."""
    try:
        cursor.execute(f"SELECT FIRST {limit} * FROM {table_name}")
        columns = [desc[0].strip() for desc in cursor.description]
        rows = cursor.fetchall()
        
        samples = []
        for row in rows:
            sample = {}
            for col, val in zip(columns, row):
                sample[col] = convert_value(val)
            samples.append(sample)
        return samples
    except Exception as e:
        return [{"error": str(e)}]

def main():
    print("=" * 70)
    print("OceanZ - Firebird Database Inspector")
    print("=" * 70)
    print()
    
    # Copy database file first
    print(f"[1] Copying database from: {SOURCE_FDB_PATH}")
    try:
        os.makedirs(os.path.dirname(WORKING_FDB_PATH), exist_ok=True)
        shutil.copy2(SOURCE_FDB_PATH, WORKING_FDB_PATH)
        print(f"    Copied to: {WORKING_FDB_PATH}")
    except Exception as e:
        print(f"    [ERROR] Failed to copy: {e}")
        return
    
    # Connect to database
    print(f"\n[2] Connecting to Firebird database...")
    try:
        conn = fdb.connect(
            dsn=WORKING_FDB_PATH,
            user=FIREBIRD_USER,
            password=FIREBIRD_PASSWORD
        )
        cursor = conn.cursor()
        print("    Connected successfully!")
    except Exception as e:
        print(f"    [ERROR] Connection failed: {e}")
        return
    
    # Get all tables
    print(f"\n[3] Extracting table metadata...")
    tables = get_all_tables(cursor)
    print(f"    Found {len(tables)} tables")
    
    # Build metadata
    metadata = {
        "extracted_at": datetime.now().isoformat(),
        "database": SOURCE_FDB_PATH,
        "tables": {}
    }
    
    for table_name in tables:
        print(f"\n    Processing: {table_name}")
        
        columns = get_table_columns(cursor, table_name)
        pk = get_primary_key(cursor, table_name)
        row_count = get_row_count(cursor, table_name)
        samples = get_sample_data(cursor, table_name, limit=2)
        
        metadata["tables"][table_name] = {
            "row_count": row_count,
            "primary_key": pk,
            "columns": columns,
            "sample_data": samples
        }
        
        print(f"      - {len(columns)} columns, {row_count} rows")
    
    conn.close()
    
    # Save to file
    output_file = os.path.join(os.path.dirname(__file__), "fdb_metadata.json")
    print(f"\n[4] Saving metadata to: {output_file}")
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False, default=str)
    
    print("\n" + "=" * 70)
    print("DONE! Please share the contents of fdb_metadata.json")
    print("=" * 70)
    
    # Also print a summary
    print("\n\nQUICK SUMMARY:")
    print("-" * 50)
    
    key_tables = ["MEMBERS", "MEMBERSHISTORY", "SESSIONS", "GROUPS"]
    for table_name in key_tables:
        if table_name in metadata["tables"]:
            table = metadata["tables"][table_name]
            print(f"\n{table_name} ({table['row_count']} rows)")
            print("  Columns:")
            for col in table["columns"]:
                nullable = "" if col["nullable"] else " NOT NULL"
                print(f"    - {col['name']}: {col['type']}{nullable}")

if __name__ == "__main__":
    main()
