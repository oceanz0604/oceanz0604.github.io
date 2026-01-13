#!/usr/bin/env python3
"""
OceanZ Sync Service - Firebase-controlled Background Service with Auto-Scheduling

This service runs on the FDB database machine and:
1. Monitors Firebase for manual sync requests from the web UI
2. Automatically runs scheduled syncs:
   - IP Logs: Every 2 minutes
   - Complete Sync (FDB + Leaderboards): Every 15 minutes

Firebase Paths Used:
- /sync-control/request      - Trigger: set to timestamp to request sync
- /sync-control/status       - Current status: idle, syncing, completed, error
- /sync-control/progress     - Progress messages array
- /sync-control/last_sync    - Last successful sync info
- /sync-control/schedule     - Next scheduled sync times

Usage:
    python sync_service.py           # Run with auto-scheduling (default)
    python sync_service.py --test    # Run full sync once and exit
    python sync_service.py --daemon  # Run as background daemon (Linux)
"""

import os
import sys
import time
import signal
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent))

import firebase_admin
from firebase_admin import credentials, db
from config import FB_PATHS, FIREBASE_CRED_PATH, FDB_FIREBASE_DB_URL

# Import functions from the unified sync script
from oceanz_sync import (
    init_firebase as init_sync_firebase,
    copy_fdb_file,
    connect_to_firebird,
    load_local_sync_state, save_local_sync_state,
    fetch_new_history_records, process_and_upload_history,
    fetch_all_members, process_and_upload_members,
    fetch_recent_sessions, process_and_upload_sessions,
    parse_messages_file, upload_guest_sessions,
    load_iplogs_state, save_iplogs_state,
    read_new_log_lines, parse_log_lines,
    process_entries_incremental, build_complete_terminal_status,
    upload_sessions, upload_terminal_status, cleanup_old_sessions,
    calculate_leaderboards_from_firebase
)

# ==================== CONFIG ====================

POLL_INTERVAL = 5  # Seconds between checks
HEARTBEAT_INTERVAL = 30  # Seconds between heartbeat updates

# Auto-sync intervals (in minutes)
IPLOGS_INTERVAL = 2      # IP logs every 2 minutes
FDB_INTERVAL = 15        # FDB database every 15 minutes

# Firebase paths for sync control
SYNC_CONTROL_PATH = "sync-control"
REQUEST_PATH = f"{SYNC_CONTROL_PATH}/request"
STATUS_PATH = f"{SYNC_CONTROL_PATH}/status"
PROGRESS_PATH = f"{SYNC_CONTROL_PATH}/progress"
CURRENT_TASK_PATH = f"{SYNC_CONTROL_PATH}/current_task"
LAST_SYNC_PATH = f"{SYNC_CONTROL_PATH}/last_sync"
HEARTBEAT_PATH = f"{SYNC_CONTROL_PATH}/service_heartbeat"
SCHEDULE_PATH = f"{SYNC_CONTROL_PATH}/schedule"

# ==================== FIREBASE INIT ====================

def init_firebase():
    """Initialize Firebase Admin SDK."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {
            'databaseURL': FDB_FIREBASE_DB_URL
        })
    return db

# ==================== SYNC SERVICE ====================

class SyncService:
    def __init__(self):
        self.db = init_firebase()
        self.running = True
        self.syncing = False
        self.last_request_id = None
        self.progress_messages = []
        
        # Track last auto-sync times
        self.last_iplogs_sync = None
        self.last_fdb_sync = None
        
    def log(self, message, level="INFO", update_firebase=True):
        """Log message locally and optionally to Firebase."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] [{level}] {message}"
        print(log_entry)
        
        if update_firebase:
            # Add to progress messages
            self.progress_messages.append({
                "time": timestamp,
                "message": message,
                "level": level
            })
            
            # Keep only last 50 messages
            if len(self.progress_messages) > 50:
                self.progress_messages = self.progress_messages[-50:]
            
            # Update Firebase progress
            try:
                self.db.reference(PROGRESS_PATH).set(self.progress_messages)
            except Exception as e:
                print(f"Failed to update Firebase progress: {e}")
    
    def set_status(self, status, task=None):
        """Update sync status in Firebase."""
        try:
            # Ensure status is never None (Firebase doesn't accept None)
            if status is None:
                status = "idle"
            self.db.reference(STATUS_PATH).set(status)
            
            if task:
                self.db.reference(CURRENT_TASK_PATH).set(task)
            elif status in ["idle", "completed", "error", "offline"]:
                # Use delete() instead of set(None) - Firebase doesn't accept None
                try:
                    self.db.reference(CURRENT_TASK_PATH).delete()
                except Exception:
                    pass  # Ignore if path doesn't exist
        except Exception as e:
            print(f"Failed to update status: {e}")
    
    def update_heartbeat(self):
        """Update service heartbeat to show it's alive."""
        try:
            next_iplogs = self.last_iplogs_sync + timedelta(minutes=IPLOGS_INTERVAL) if self.last_iplogs_sync else datetime.now()
            next_fdb = self.last_fdb_sync + timedelta(minutes=FDB_INTERVAL) if self.last_fdb_sync else datetime.now()
            
            self.db.reference(HEARTBEAT_PATH).set({
                "timestamp": datetime.now().isoformat(),
                "status": "syncing" if self.syncing else "idle",
                "next_iplogs": next_iplogs.isoformat(),
                "next_fdb": next_fdb.isoformat()
            })
        except Exception as e:
            print(f"Failed to update heartbeat: {e}")
    
    def update_schedule_info(self):
        """Update schedule info in Firebase for UI display."""
        try:
            next_iplogs = self.last_iplogs_sync + timedelta(minutes=IPLOGS_INTERVAL) if self.last_iplogs_sync else datetime.now()
            next_fdb = self.last_fdb_sync + timedelta(minutes=FDB_INTERVAL) if self.last_fdb_sync else datetime.now()
            
            schedule_data = {
                "iplogs_interval_mins": IPLOGS_INTERVAL,
                "fdb_interval_mins": FDB_INTERVAL,
                "next_iplogs": next_iplogs.isoformat(),
                "next_fdb": next_fdb.isoformat(),
            }
            
            # Only add last sync times if they exist (Firebase doesn't accept None)
            if self.last_iplogs_sync:
                schedule_data["last_iplogs"] = self.last_iplogs_sync.isoformat()
            if self.last_fdb_sync:
                schedule_data["last_fdb"] = self.last_fdb_sync.isoformat()
            
            self.db.reference(SCHEDULE_PATH).set(schedule_data)
        except Exception as e:
            print(f"Failed to update schedule: {e}")
    
    def check_for_request(self):
        """Check if there's a new sync request from web UI."""
        try:
            request_ref = self.db.reference(REQUEST_PATH)
            request = request_ref.get()
            
            if request and request != self.last_request_id:
                self.last_request_id = request
                return True
            return False
        except Exception as e:
            print(f"Error checking request: {e}")
            return False
    
    def run_iplogs_sync(self, silent=False):
        """Run IP logs sync directly (no subprocess)."""
        if not silent:
            self.log("Starting: IP Logs & Terminal Status")
            self.set_status("syncing", "IP Logs & Terminal Status")
        else:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Running: IP Logs sync")
        
        try:
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
                    
                    if not silent:
                        self.log(f"  Active: {len(active)} | Completed: {len(completed)}")
            
            iplogs_state["last_file"] = current_file
            iplogs_state["last_line_count"] = line_count
            iplogs_state["last_sync"] = datetime.now().isoformat()
            
            save_iplogs_state(iplogs_state)
            
            db.reference(f"{FB_PATHS.SYNC_META}/iplogs").update({
                "last_sync": datetime.now().isoformat(),
                "status": "ok"
            })
            
            if not silent:
                self.log("Completed: IP Logs & Terminal Status", "SUCCESS")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] [OK] IP Logs sync completed")
            
            return True
            
        except Exception as e:
            if not silent:
                self.log(f"IP Logs sync error: {e}", "ERROR")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] [ERROR] IP Logs: {e}")
            return False
    
    def run_fdb_sync(self, silent=False):
        """Run FDB database sync directly (no subprocess)."""
        if not silent:
            self.log("Starting: FDB Database Sync")
            self.set_status("syncing", "FDB Database Sync")
        else:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Running: FDB sync")
        
        try:
            copy_fdb_file()
            conn = connect_to_firebird()
            cursor = conn.cursor()
            
            sync_state = load_local_sync_state()
            
            # History
            new_records = fetch_new_history_records(cursor, sync_state.get("last_history_id", 0))
            new_max_id = process_and_upload_history(new_records, sync_state)
            sync_state["last_history_id"] = new_max_id
            
            # Members
            members = fetch_all_members(cursor)
            new_hashes = process_and_upload_members(members, sync_state)
            sync_state["member_hashes"] = new_hashes
            
            # Sessions
            sessions = fetch_recent_sessions(cursor, hours=2)
            process_and_upload_sessions(sessions)
            
            # Guest sessions
            guest_sessions = parse_messages_file()
            if guest_sessions:
                upload_guest_sessions(guest_sessions)
            
            sync_state["last_sync_time"] = datetime.now().isoformat()
            save_local_sync_state(sync_state)
            
            # Update Firebase sync meta
            db.reference("sync-meta").update({
                "last_fdb_sync": datetime.now().isoformat(),
                "last_history_id": new_max_id,
                "records_synced": len(new_records)
            })
            
            conn.close()
            
            if not silent:
                self.log(f"  FDB: {len(new_records)} new history records", "SUCCESS")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] [OK] FDB sync: {len(new_records)} records")
            
            return True
            
        except Exception as e:
            if not silent:
                self.log(f"FDB sync error: {e}", "ERROR")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] [ERROR] FDB: {e}")
            return False
    
    def run_leaderboard_sync(self, silent=False):
        """Run leaderboard calculation directly (no subprocess)."""
        if not silent:
            self.log("Starting: Leaderboard Calculation")
            self.set_status("syncing", "Leaderboard Calculation")
        else:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Running: Leaderboard calculation")
        
        try:
            success = calculate_leaderboards_from_firebase()
            
            if success:
                if not silent:
                    self.log("Completed: Leaderboard Calculation", "SUCCESS")
                else:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] [OK] Leaderboards updated")
            
            return success
            
        except Exception as e:
            if not silent:
                self.log(f"Leaderboard sync error: {e}", "ERROR")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] [ERROR] Leaderboards: {e}")
            return False
    
    def perform_full_sync(self, triggered_by="web_ui"):
        """Execute the full sync process (triggered by web UI)."""
        self.syncing = True
        self.progress_messages = []
        start_time = datetime.now()
        
        self.log("=" * 50)
        self.log(f"[SYNC] FULL SYNC STARTED (triggered by {triggered_by})")
        self.log("=" * 50)
        self.set_status("syncing", "Initializing...")
        
        tasks_completed = 0
        tasks_failed = 0
        
        # 1. FDB Sync
        if self.run_fdb_sync(silent=False):
            tasks_completed += 1
        else:
            tasks_failed += 1
        
        # 2. IP Logs Sync
        if self.run_iplogs_sync(silent=False):
            tasks_completed += 1
        else:
            tasks_failed += 1
        
        # 3. Leaderboard Calculation
        if self.run_leaderboard_sync(silent=False):
            tasks_completed += 1
        else:
            tasks_failed += 1
        
        success = tasks_failed == 0
        
        # Update last sync times
        self.last_fdb_sync = datetime.now()
        self.last_iplogs_sync = datetime.now()
        
        # Calculate duration
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        # Update last sync info
        sync_info = {
            "timestamp": end_time.isoformat(),
            "duration_seconds": round(duration, 2),
            "tasks_completed": tasks_completed,
            "tasks_failed": tasks_failed,
            "success": success,
            "triggered_by": triggered_by
        }
        
        try:
            self.db.reference(LAST_SYNC_PATH).set(sync_info)
        except Exception as e:
            print(f"Failed to update last_sync: {e}")
        
        self.log("=" * 50)
        if success:
            self.log(f"[OK] SYNC COMPLETED in {duration:.1f}s")
            self.set_status("completed")
        else:
            self.log(f"[WARN] SYNC COMPLETED WITH ERRORS in {duration:.1f}s")
            self.set_status("error")
        self.log("=" * 50)
        
        self.syncing = False
        self.update_schedule_info()
        
        # Reset to idle after 10 seconds
        time.sleep(10)
        self.set_status("idle")
        
        return success
    
    def auto_sync_iplogs(self):
        """Run IP logs sync silently (scheduled)."""
        print(f"\n[AUTO-SYNC] IP Logs - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.syncing = True
        
        success = self.run_iplogs_sync(silent=True)
        
        self.last_iplogs_sync = datetime.now()
        self.syncing = False
        self.update_schedule_info()
        
        return success
    
    def auto_sync_fdb(self):
        """Run complete sync silently (scheduled) - includes FDB, IP Logs, and Leaderboards."""
        print(f"\n[AUTO-SYNC] Complete Sync - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.syncing = True
        
        # Run all three syncs
        fdb_ok = self.run_fdb_sync(silent=True)
        iplogs_ok = self.run_iplogs_sync(silent=True)
        leaders_ok = self.run_leaderboard_sync(silent=True)
        
        self.last_fdb_sync = datetime.now()
        self.last_iplogs_sync = datetime.now()
        self.syncing = False
        self.update_schedule_info()
        
        return fdb_ok and iplogs_ok and leaders_ok
    
    def check_scheduled_syncs(self):
        """Check if any scheduled syncs are due."""
        now = datetime.now()
        
        # Check IP logs (every 2 minutes) - run quick IP logs only
        if self.last_iplogs_sync is None or (now - self.last_iplogs_sync).total_seconds() >= IPLOGS_INTERVAL * 60:
            self.auto_sync_iplogs()
        
        # Check FDB + Leaderboards (every 15 minutes) - run complete sync
        if self.last_fdb_sync is None or (now - self.last_fdb_sync).total_seconds() >= FDB_INTERVAL * 60:
            self.auto_sync_fdb()  # This runs complete sync which includes leaderboards
    
    def run(self):
        """Main service loop with auto-scheduling."""
        print(f"""
================================================================
           OceanZ Sync Service                             
   Auto-Scheduling + Firebase Control                      
----------------------------------------------------------------
   IP Logs:    Every {IPLOGS_INTERVAL} minutes                          
   FDB Data:   Every {FDB_INTERVAL} minutes                         
   Manual:     Via Firebase request                     
================================================================
        """)
        
        self.log("[START] OceanZ Sync Service Starting...", update_firebase=True)
        self.log(f"[SCHEDULE] IP Logs every {IPLOGS_INTERVAL}m, FDB every {FDB_INTERVAL}m")
        self.set_status("idle")
        self.update_heartbeat()
        
        # Run initial sync (unified sync handles everything)
        print("\n[STARTUP] Running initial unified sync...")
        self.auto_sync_fdb()  # Unified sync includes IP logs and leaderboards
        
        last_heartbeat = time.time()
        
        try:
            while self.running:
                # Priority 1: Check for manual sync request from web UI
                if not self.syncing and self.check_for_request():
                    self.log("[REQUEST] Manual sync request received!")
                    self.perform_full_sync(triggered_by="web_ui")
                
                # Priority 2: Check scheduled syncs (only if not currently syncing)
                if not self.syncing:
                    self.check_scheduled_syncs()
                
                # Update heartbeat periodically
                if time.time() - last_heartbeat > HEARTBEAT_INTERVAL:
                    self.update_heartbeat()
                    last_heartbeat = time.time()
                
                time.sleep(POLL_INTERVAL)
                
        except KeyboardInterrupt:
            self.log("[STOP] Service stopping...")
        finally:
            self.set_status("offline")
            self.log("[EXIT] Service stopped")
    
    def stop(self):
        """Stop the service gracefully."""
        self.running = False


# ==================== SIGNAL HANDLERS ====================

service = None

def signal_handler(signum, frame):
    """Handle shutdown signals."""
    global service
    if service:
        service.stop()

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ==================== MAIN ====================

def main():
    global service
    
    # Check for command line arguments
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        
        if arg == "--help":
            print(__doc__)
            return
        
        if arg == "--test":
            print("Running in TEST mode - single full sync")
            service = SyncService()
            service.perform_full_sync(triggered_by="test")
            return
        
        if arg == "--daemon":
            print("Running as daemon...")
            if hasattr(os, 'fork') and os.fork() > 0:
                sys.exit(0)
    
    # Normal mode with auto-scheduling
    service = SyncService()
    service.run()


if __name__ == "__main__":
    main()
