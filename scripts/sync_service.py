#!/usr/bin/env python3
"""
OceanZ Sync Service - Firebase-controlled Background Service with Auto-Scheduling

This service runs on the FDB database machine and:
1. Monitors Firebase for manual sync requests from the web UI
2. Automatically runs scheduled syncs:
   - IP Logs: Every 2 minutes
   - FDB Database: Every 15 minutes
   - Leaderboards: Every 15 minutes (with FDB)

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
import subprocess
import signal
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent))

import firebase_admin
from firebase_admin import credentials, db
from config import FB_PATHS, FIREBASE_CRED_PATH, FDB_FIREBASE_DB_URL

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

# Script directory
SCRIPT_DIR = Path(__file__).parent

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
    
    def run_script(self, script_name, description, silent=False):
        """Run a Python script and capture output."""
        script_path = SCRIPT_DIR / script_name
        
        if not script_path.exists():
            self.log(f"Script not found: {script_path}", "ERROR", not silent)
            return False
        
        if not silent:
            self.log(f"Starting: {description}")
            self.set_status("syncing", description)
        else:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Running: {description}")
        
        try:
            result = subprocess.run(
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                cwd=str(SCRIPT_DIR),
                timeout=600  # 10 minute timeout
            )
            
            # Log output
            if result.stdout and not silent:
                for line in result.stdout.strip().split('\n'):
                    if line.strip():
                        self.log(f"  {line}")
            
            if result.returncode != 0:
                self.log(f"Script failed with code {result.returncode}", "ERROR", not silent)
                if result.stderr:
                    error_msg = result.stderr[:500]
                    self.log(f"  Error: {error_msg}", "ERROR", not silent)
                return False
            
            if not silent:
                self.log(f"Completed: {description}", "SUCCESS")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] [OK] Completed: {description}")
            
            return True
            
        except subprocess.TimeoutExpired:
            self.log(f"Script timed out: {script_name}", "ERROR", not silent)
            return False
        except Exception as e:
            self.log(f"Script error: {e}", "ERROR", not silent)
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
        
        success = True
        tasks_completed = 0
        tasks_failed = 0
        
        # Run complete unified sync (includes FDB, IP Logs, and Leaderboards)
        if self.run_script("oceanz_sync.py", "Complete Sync (FDB + IP Logs + Leaderboards)"):
            tasks_completed = 3  # Single script handles all 3
        else:
            tasks_failed = 3
            success = False
        
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
        
        success = self.run_script("iplogsupload.py", "Auto: IP Logs & Terminal Status", silent=True)
        
        self.last_iplogs_sync = datetime.now()
        self.syncing = False
        self.update_schedule_info()
        
        return success
    
    def auto_sync_fdb(self):
        """Run complete sync silently (scheduled) - includes FDB, IP Logs, and Leaderboards."""
        print(f"\n[AUTO-SYNC] Complete Sync - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.syncing = True
        
        success = self.run_script("oceanz_sync.py", "Auto: Complete Sync (FDB + IP Logs + Leaderboards)", silent=True)
        
        self.last_fdb_sync = datetime.now()
        self.last_iplogs_sync = datetime.now()  # Complete sync also handles IP logs
        self.syncing = False
        self.update_schedule_info()
        
        return success
    
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
