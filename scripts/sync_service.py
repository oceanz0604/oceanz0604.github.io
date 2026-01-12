#!/usr/bin/env python3
"""
OceanZ Sync Service - Firebase-controlled Background Service

This service runs on the FDB database machine and monitors Firebase for sync requests.
When a sync is requested via the web UI, this service performs the sync and reports progress.

Firebase Paths Used:
- /sync-control/request      - Trigger: set to timestamp to request sync
- /sync-control/status       - Current status: idle, syncing, completed, error
- /sync-control/progress     - Progress messages array
- /sync-control/last_sync    - Last successful sync info
- /sync-control/current_task - Current task being executed

Usage:
    python sync_service.py           # Run in foreground
    python sync_service.py --daemon  # Run as background daemon (Linux)

Install as Windows Service:
    pip install pywin32
    python sync_service.py --install
    python sync_service.py --start
"""

import os
import sys
import time
import json
import threading
import subprocess
import signal
from datetime import datetime
from pathlib import Path

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent))

import firebase_admin
from firebase_admin import credentials, db
from config import FB_PATHS, FIREBASE_CRED_PATH, FIREBASE_DB_URL, FDB_FIREBASE_DB_URL

# ==================== CONFIG ====================

POLL_INTERVAL = 5  # Seconds between Firebase checks
HEARTBEAT_INTERVAL = 30  # Seconds between heartbeat updates

# Firebase paths for sync control
SYNC_CONTROL_PATH = "sync-control"
REQUEST_PATH = f"{SYNC_CONTROL_PATH}/request"
STATUS_PATH = f"{SYNC_CONTROL_PATH}/status"
PROGRESS_PATH = f"{SYNC_CONTROL_PATH}/progress"
CURRENT_TASK_PATH = f"{SYNC_CONTROL_PATH}/current_task"
LAST_SYNC_PATH = f"{SYNC_CONTROL_PATH}/last_sync"
HEARTBEAT_PATH = f"{SYNC_CONTROL_PATH}/service_heartbeat"

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

# ==================== STATUS MANAGEMENT ====================

class SyncService:
    def __init__(self):
        self.db = init_firebase()
        self.running = True
        self.syncing = False
        self.last_request_id = None
        self.progress_messages = []
        
    def log(self, message, level="INFO"):
        """Log message locally and to Firebase."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] [{level}] {message}"
        print(log_entry)
        
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
            self.db.reference(STATUS_PATH).set(status)
            if task:
                self.db.reference(CURRENT_TASK_PATH).set(task)
            elif status in ["idle", "completed", "error"]:
                self.db.reference(CURRENT_TASK_PATH).set(None)
        except Exception as e:
            print(f"Failed to update status: {e}")
    
    def update_heartbeat(self):
        """Update service heartbeat to show it's alive."""
        try:
            self.db.reference(HEARTBEAT_PATH).set({
                "timestamp": datetime.now().isoformat(),
                "status": "syncing" if self.syncing else "idle"
            })
        except Exception as e:
            print(f"Failed to update heartbeat: {e}")
    
    def check_for_request(self):
        """Check if there's a new sync request."""
        try:
            request_ref = self.db.reference(REQUEST_PATH)
            request = request_ref.get()
            
            if request and request != self.last_request_id:
                # New request detected
                self.last_request_id = request
                return True
            return False
        except Exception as e:
            print(f"Error checking request: {e}")
            return False
    
    def run_script(self, script_name, description):
        """Run a Python script and capture output."""
        script_path = SCRIPT_DIR / script_name
        
        if not script_path.exists():
            self.log(f"Script not found: {script_path}", "ERROR")
            return False
        
        self.log(f"Starting: {description}")
        self.set_status("syncing", description)
        
        try:
            # Run the script
            result = subprocess.run(
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                cwd=str(SCRIPT_DIR),
                timeout=600  # 10 minute timeout
            )
            
            # Log output
            if result.stdout:
                for line in result.stdout.strip().split('\n'):
                    if line.strip():
                        self.log(f"  {line}")
            
            if result.returncode != 0:
                self.log(f"Script failed with code {result.returncode}", "ERROR")
                if result.stderr:
                    self.log(f"  Error: {result.stderr[:500]}", "ERROR")
                return False
            
            self.log(f"Completed: {description}", "SUCCESS")
            return True
            
        except subprocess.TimeoutExpired:
            self.log(f"Script timed out: {script_name}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Script error: {e}", "ERROR")
            return False
    
    def perform_sync(self):
        """Execute the full sync process."""
        self.syncing = True
        self.progress_messages = []
        start_time = datetime.now()
        
        self.log("=" * 50)
        self.log("🔄 SYNC STARTED")
        self.log("=" * 50)
        self.set_status("syncing", "Initializing...")
        
        success = True
        tasks_completed = 0
        tasks_failed = 0
        
        # Define sync tasks
        tasks = [
            ("fdbupload.py", "Syncing PanCafe Database (Members, History, Sessions)"),
            ("iplogsupload.py", "Processing IP Logs"),
        ]
        
        for script, description in tasks:
            if self.run_script(script, description):
                tasks_completed += 1
            else:
                tasks_failed += 1
                success = False
        
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
            "triggered_by": "web_ui"
        }
        
        try:
            self.db.reference(LAST_SYNC_PATH).set(sync_info)
        except Exception as e:
            print(f"Failed to update last_sync: {e}")
        
        self.log("=" * 50)
        if success:
            self.log(f"✅ SYNC COMPLETED in {duration:.1f}s")
            self.set_status("completed")
        else:
            self.log(f"⚠️ SYNC COMPLETED WITH ERRORS in {duration:.1f}s")
            self.set_status("error")
        self.log("=" * 50)
        
        self.syncing = False
        
        # Reset to idle after 10 seconds
        time.sleep(10)
        self.set_status("idle")
        
        return success
    
    def run(self):
        """Main service loop."""
        self.log("🚀 OceanZ Sync Service Starting...")
        self.set_status("idle")
        self.update_heartbeat()
        
        last_heartbeat = time.time()
        
        try:
            while self.running:
                # Check for sync request
                if not self.syncing and self.check_for_request():
                    self.log("📥 Sync request received!")
                    self.perform_sync()
                
                # Update heartbeat periodically
                if time.time() - last_heartbeat > HEARTBEAT_INTERVAL:
                    self.update_heartbeat()
                    last_heartbeat = time.time()
                
                time.sleep(POLL_INTERVAL)
                
        except KeyboardInterrupt:
            self.log("⏹️ Service stopping...")
        finally:
            self.set_status("offline")
            self.log("👋 Service stopped")
    
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
    
    print("""
╔══════════════════════════════════════════════════════════╗
║           OceanZ Sync Service                             ║
║   Firebase-controlled Database Synchronization            ║
╚══════════════════════════════════════════════════════════╝
    """)
    
    # Check for command line arguments
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        
        if arg == "--help":
            print(__doc__)
            return
        
        if arg == "--test":
            # Test mode: run sync once and exit
            print("Running in TEST mode - single sync")
            service = SyncService()
            service.perform_sync()
            return
        
        if arg == "--daemon":
            # Daemon mode (Linux)
            print("Running as daemon...")
            # Fork to background
            if os.fork() > 0:
                sys.exit(0)
    
    # Normal mode
    service = SyncService()
    service.run()


if __name__ == "__main__":
    main()

