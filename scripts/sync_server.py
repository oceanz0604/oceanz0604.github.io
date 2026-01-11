"""
OceanZ Gaming Cafe - Local Sync Server

A lightweight HTTP server that runs on the counter computer.
Allows the admin UI to trigger sync scripts on-demand.

Usage:
  1. Run: python sync_server.py
  2. Server starts on http://localhost:5555
  3. Admin UI can call endpoints to trigger syncs

Endpoints:
  GET  /status          - Check server status
  POST /sync/fdb        - Run FDB upload (members, history)
  POST /sync/iplogs     - Run IP logs upload (terminal status)
  POST /sync/leaderboard - Run leaderboard calculation
  POST /sync/all        - Run all syncs in sequence
  GET  /sync/progress   - SSE stream for real-time progress

Auto-start with Windows:
  Create a shortcut in shell:startup folder pointing to this script
"""

import os
import sys
import json
import threading
import subprocess
import time
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import queue

# ==================== CONFIGURATION ====================

HOST = "127.0.0.1"  # Only localhost for security
PORT = 5555
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Script paths
SCRIPTS = {
    "fdb": os.path.join(SCRIPT_DIR, "fdbupload.py"),
    "iplogs": os.path.join(SCRIPT_DIR, "iplogsupload.py"),
    "leaderboard": os.path.join(SCRIPT_DIR, "monthly_leaderboard.py"),
}

# ==================== GLOBAL STATE ====================

# Progress queue for SSE
progress_queues = []
current_sync = {
    "running": False,
    "script": None,
    "started_at": None,
    "progress": [],
    "error": None
}

# ==================== SYNC RUNNER ====================

def run_script(script_name, script_path):
    """Run a Python script and capture output."""
    global current_sync
    
    current_sync["running"] = True
    current_sync["script"] = script_name
    current_sync["started_at"] = datetime.now().isoformat()
    current_sync["progress"] = []
    current_sync["error"] = None
    
    broadcast_progress({
        "type": "start",
        "script": script_name,
        "message": f"Starting {script_name} sync..."
    })
    
    try:
        # Run the script
        process = subprocess.Popen(
            [sys.executable, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=SCRIPT_DIR
        )
        
        # Stream output
        for line in iter(process.stdout.readline, ''):
            line = line.strip()
            if line:
                current_sync["progress"].append(line)
                broadcast_progress({
                    "type": "progress",
                    "script": script_name,
                    "message": line
                })
        
        process.wait()
        
        if process.returncode == 0:
            broadcast_progress({
                "type": "complete",
                "script": script_name,
                "message": f"{script_name} sync completed successfully!",
                "success": True
            })
            return True
        else:
            current_sync["error"] = f"Script exited with code {process.returncode}"
            broadcast_progress({
                "type": "error",
                "script": script_name,
                "message": f"{script_name} sync failed (exit code: {process.returncode})",
                "success": False
            })
            return False
            
    except Exception as e:
        current_sync["error"] = str(e)
        broadcast_progress({
            "type": "error",
            "script": script_name,
            "message": f"Error running {script_name}: {str(e)}",
            "success": False
        })
        return False
    finally:
        current_sync["running"] = False


def run_all_syncs():
    """Run all sync scripts in sequence."""
    results = {}
    
    broadcast_progress({
        "type": "start",
        "script": "all",
        "message": "Starting full sync (FDB → IPLogs → Leaderboard)..."
    })
    
    for name in ["fdb", "iplogs", "leaderboard"]:
        if name in SCRIPTS:
            results[name] = run_script(name, SCRIPTS[name])
            time.sleep(1)  # Small delay between scripts
    
    all_success = all(results.values())
    broadcast_progress({
        "type": "complete",
        "script": "all",
        "message": "Full sync completed!" if all_success else "Some syncs failed",
        "success": all_success,
        "results": results
    })
    
    return results


def broadcast_progress(data):
    """Send progress to all connected SSE clients."""
    message = f"data: {json.dumps(data)}\n\n"
    dead_queues = []
    
    for q in progress_queues:
        try:
            q.put_nowait(message)
        except:
            dead_queues.append(q)
    
    # Clean up disconnected clients
    for q in dead_queues:
        try:
            progress_queues.remove(q)
        except:
            pass


# ==================== HTTP HANDLER ====================

class SyncHandler(BaseHTTPRequestHandler):
    """HTTP request handler for sync endpoints."""
    
    def log_message(self, format, *args):
        """Custom logging."""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")
    
    def send_cors_headers(self):
        """Send CORS headers for browser access."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
    
    def send_json(self, data, status=200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests."""
        path = urlparse(self.path).path
        
        if path == "/status":
            self.send_json({
                "status": "ok",
                "server": "OceanZ Sync Server",
                "version": "1.0",
                "running": current_sync["running"],
                "current_script": current_sync["script"],
                "timestamp": datetime.now().isoformat()
            })
        
        elif path == "/sync/progress":
            # Server-Sent Events for real-time progress
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_cors_headers()
            self.end_headers()
            
            # Create a queue for this client
            client_queue = queue.Queue()
            progress_queues.append(client_queue)
            
            try:
                # Send initial status
                initial = f"data: {json.dumps({'type': 'connected', 'running': current_sync['running']})}\n\n"
                self.wfile.write(initial.encode())
                self.wfile.flush()
                
                # Stream progress
                while True:
                    try:
                        message = client_queue.get(timeout=30)
                        self.wfile.write(message.encode())
                        self.wfile.flush()
                    except queue.Empty:
                        # Send keepalive
                        self.wfile.write(": keepalive\n\n".encode())
                        self.wfile.flush()
            except:
                pass
            finally:
                try:
                    progress_queues.remove(client_queue)
                except:
                    pass
        
        elif path == "/sync/status":
            self.send_json({
                "running": current_sync["running"],
                "script": current_sync["script"],
                "started_at": current_sync["started_at"],
                "progress": current_sync["progress"][-20:],  # Last 20 lines
                "error": current_sync["error"]
            })
        
        else:
            self.send_json({"error": "Not found"}, 404)
    
    def do_POST(self):
        """Handle POST requests."""
        path = urlparse(self.path).path
        
        # Check if already running
        if current_sync["running"]:
            self.send_json({
                "error": "Sync already in progress",
                "script": current_sync["script"]
            }, 409)
            return
        
        if path == "/sync/fdb":
            threading.Thread(target=run_script, args=("fdb", SCRIPTS["fdb"])).start()
            self.send_json({"status": "started", "script": "fdb"})
        
        elif path == "/sync/iplogs":
            threading.Thread(target=run_script, args=("iplogs", SCRIPTS["iplogs"])).start()
            self.send_json({"status": "started", "script": "iplogs"})
        
        elif path == "/sync/leaderboard":
            threading.Thread(target=run_script, args=("leaderboard", SCRIPTS["leaderboard"])).start()
            self.send_json({"status": "started", "script": "leaderboard"})
        
        elif path == "/sync/all":
            threading.Thread(target=run_all_syncs).start()
            self.send_json({"status": "started", "script": "all"})
        
        else:
            self.send_json({"error": "Not found"}, 404)


# ==================== MAIN ====================

def main():
    """Start the sync server."""
    print("\n" + "="*50)
    print("🎮 OceanZ Sync Server")
    print("="*50)
    print(f"\n📡 Starting server on http://{HOST}:{PORT}")
    print("\nEndpoints:")
    print(f"  GET  /status           - Check server status")
    print(f"  POST /sync/fdb         - Sync PanCafe database")
    print(f"  POST /sync/iplogs      - Sync terminal status")
    print(f"  POST /sync/leaderboard - Update leaderboards")
    print(f"  POST /sync/all         - Run all syncs")
    print(f"  GET  /sync/progress    - SSE progress stream")
    print("\nPress Ctrl+C to stop\n")
    
    try:
        server = HTTPServer((HOST, PORT), SyncHandler)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Server stopped")
    except Exception as e:
        print(f"\n❌ Server error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

