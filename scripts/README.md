# OceanZ Scripts - Setup Guide

## Overview

These Python scripts sync data from PanCafe Pro (Firebird DB) to Firebase:

| Script | Purpose | Frequency |
|--------|---------|-----------|
| `fdbupload.py` | Sync members, history, sessions | Every 30 mins |
| `iplogsupload.py` | Sync terminal status | Every 2 mins |
| `monthly_leaderboard.py` | Calculate leaderboards | Every 30 mins |
| `sync_server.py` | HTTP server for on-demand sync | Always running |

## Quick Setup

### 1. Install Dependencies

```bash
pip install firebase-admin fdb
```

### 2. Configure Paths

Edit `config.py` and update these paths for your system:

```python
SOURCE_FDB_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB.dat"
FIREBASE_CRED_PATH = r"C:\Firebase\fbcreds.json"
IPLOG_BASE_PATH = r"C:\Users\decrypter\Downloads\iplogs\iplogs"
```

### 3. Start Sync Server

Double-click `start_sync_server.bat` or run:

```bash
python sync_server.py
```

The server will start on `http://127.0.0.1:5555`

### 4. Configure Windows Task Scheduler

Create these scheduled tasks:

**Task 1: FDB Upload (Every 30 mins)**
- Program: `python.exe`
- Arguments: `C:\path\to\scripts\fdbupload.py`
- Trigger: Every 30 minutes

**Task 2: IP Logs Upload (Every 2 mins)**
- Program: `python.exe`
- Arguments: `C:\path\to\scripts\iplogsupload.py`
- Trigger: Every 2 minutes

**Task 3: Leaderboard (Every 30 mins)**
- Program: `python.exe`
- Arguments: `C:\path\to\scripts\monthly_leaderboard.py`
- Trigger: Every 30 minutes

**Task 4: Sync Server (On Startup)**
- Program: `pythonw.exe` (no console window)
- Arguments: `C:\path\to\scripts\sync_server.py`
- Trigger: At system startup

## On-Demand Sync from Admin UI

1. Make sure `sync_server.py` is running
2. Open Admin Dashboard
3. Click "Sync Database" in the sidebar
4. Click sync buttons to trigger individual or full sync

## Sync Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Check server status |
| `/sync/fdb` | POST | Sync PanCafe database |
| `/sync/iplogs` | POST | Sync terminal status |
| `/sync/leaderboard` | POST | Update leaderboards |
| `/sync/all` | POST | Run all syncs |
| `/sync/progress` | GET | SSE stream for progress |

## Troubleshooting

### "Sync server offline"
- Make sure `sync_server.py` is running
- Check if port 5555 is not blocked by firewall

### "Failed to copy FDB file"
- PanCafe may be using the file
- Try closing PanCafe Pro Server temporarily

### "Firebase initialization failed"
- Check that `fbcreds.json` exists at the configured path
- Verify the JSON file contains valid Firebase credentials

## File Structure

```
scripts/
├── config.py              # Shared configuration
├── fdbupload.py           # FDB → Firebase sync
├── iplogsupload.py        # IP logs → Firebase sync  
├── monthly_leaderboard.py # Leaderboard calculator
├── sync_server.py         # HTTP server for on-demand sync
├── start_sync_server.bat  # Windows launcher
├── .sync_state.json       # FDB sync state (auto-generated)
├── .iplogs_state.json     # IP logs sync state (auto-generated)
├── .leaderboard_state.json # Leaderboard state (auto-generated)
└── README.md              # This file
```

