# OceanZ Firebase Sync System

## Overview

The sync service keeps Firebase updated with data from the local PanCafe Firebird database. It runs as a **single background service** with:

1. **Automatic Scheduled Syncs** - No Windows Task Scheduler needed!
2. **Manual Sync via Web UI** - Click a button to trigger immediate sync

## Auto-Sync Schedule

| Task | Interval | Description |
|------|----------|-------------|
| IP Logs | Every **2 minutes** | Terminal status, active sessions |
| FDB Database | Every **15 minutes** | Members, history, sessions, leaderboards |

## Architecture

```
┌─────────────────────┐         ┌─────────────────────────────┐
│   Admin Web UI      │         │  Counter Machine            │
│                     │         │                             │
│  Click "Sync" ──────┼────────►│  sync_service.py            │
│                     │ Firebase│  (background service)       │
│                     │ Request │                             │
│  ◄──────────────────┼─────────│  ┌─────────────────────┐    │
│  Real-time Progress │ Updates │  │ Auto-Scheduler      │    │
│  + Schedule Info    │         │  │ • IP Logs: 2 min    │    │
│                     │         │  │ • FDB: 15 min       │    │
└─────────────────────┘         │  └─────────────────────┘    │
                                │           │                  │
                                │           ▼                  │
                                │  ┌─────────────────────┐    │
                                │  │ Firebird Database   │    │
                                │  │ (PanCafe)           │    │
                                │  └─────────────────────┘    │
                                └─────────────────────────────┘
```

## Firebase Paths Used

| Path | Purpose |
|------|---------|
| `/sync-control/request` | Web UI writes here to trigger manual sync |
| `/sync-control/status` | `idle`, `syncing`, `completed`, `error`, `offline` |
| `/sync-control/progress` | Array of progress messages |
| `/sync-control/schedule` | Next scheduled sync times |
| `/sync-control/service_heartbeat` | Service health (updated every 30s) |
| `/sync-control/last_sync` | Last successful sync info |

## Setup

### 1. Install Dependencies

On the counter/database machine:

```bash
pip install firebase-admin fdb
```

### 2. Firebase Credentials

Place your Firebase Admin SDK credentials at:
```
C:\Firebase\fbcreds.json
```

Download from: Firebase Console > Project Settings > Service Accounts > Generate New Private Key

### 3. Start the Service

**Option A: Double-click**
```
start_sync_service.bat
```

**Option B: Command line**
```bash
cd scripts
python sync_service.py
```

**Option C: Auto-Start on Windows Boot**
1. Press `Win+R`, type `shell:startup`
2. Create a shortcut to `start_sync_service.bat` in this folder

### 4. Verify It's Running

The service will show:
```
╔══════════════════════════════════════════════════════════╗
║           OceanZ Sync Service                             ║
║   Auto-Scheduling + Firebase Control                      ║
╠══════════════════════════════════════════════════════════╣
║   📊 IP Logs:    Every 2 minutes                          ║
║   🗄️  FDB Data:   Every 15 minutes                         ║
║   🌐 Manual:     Via Firebase request                     ║
╚══════════════════════════════════════════════════════════╝
```

## Web UI Features

When the service is running, the admin dashboard shows:

1. **Service Status** - Green dot = online, Yellow = offline
2. **Auto-Sync Schedule** - Shows intervals and countdown to next sync
3. **Manual Sync Button** - Click to trigger immediate full sync
4. **Real-time Progress** - Watch sync progress live

## How It Works

1. **Service Startup**: Runs initial sync, then enters main loop
2. **Auto-Scheduling**: Checks every 5 seconds if a scheduled sync is due
3. **Manual Request**: Watches Firebase for manual sync requests
4. **Progress Updates**: Writes to Firebase in real-time for web UI
5. **Heartbeat**: Updates every 30 seconds so web UI knows service is alive

## Customizing Intervals

Edit `sync_service.py`:

```python
# Auto-sync intervals (in minutes)
IPLOGS_INTERVAL = 2      # IP logs every 2 minutes
FDB_INTERVAL = 15        # FDB database every 15 minutes
```

## Testing

Run a single full sync and exit:
```bash
python sync_service.py --test
```

## Troubleshooting

### Service shows as offline in web UI
- Check if `sync_service.py` is running
- Verify Firebase credentials are correct
- Check network connectivity

### Scheduled syncs not running
- Service must be running continuously
- Check the console for any error messages
- Verify Firebird database is accessible

### Manual sync doesn't start
- Check service heartbeat (should update every 30s)
- Verify Firebase rules allow writing to `/sync-control`

## Files

| File | Purpose |
|------|---------|
| `sync_service.py` | Main service with auto-scheduling |
| `fdbupload.py` | Syncs PanCafe database |
| `iplogsupload.py` | Processes IP logs and terminal status |
| `config.py` | Shared configuration |
| `start_sync_service.bat` | Windows launcher |
