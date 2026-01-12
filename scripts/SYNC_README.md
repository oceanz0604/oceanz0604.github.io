# OceanZ Firebase Sync System

## Overview

The sync system keeps the Firebase database updated with data from the local PanCafe Firebird database. It uses a **Firebase-based control mechanism** where the admin web UI triggers syncs by writing to Firebase, and a Python service running on the database machine detects these requests and performs the sync.

## Architecture

```
┌─────────────────────┐         ┌─────────────────────┐
│   Admin Web UI      │         │  Counter Machine    │
│   (dashboard.html)  │         │                     │
│                     │         │  ┌───────────────┐  │
│  Click "Sync" ──────┼────────►│  │ sync_service  │  │
│                     │  Firebase│  │    .py        │  │
│                     │  Request │  └───────┬───────┘  │
│                     │         │          │          │
│  ◄──────────────────┼─────────│          ▼          │
│  Progress/Status    │  Firebase│  ┌───────────────┐  │
│                     │  Updates │  │  fdbupload.py │  │
│                     │         │  │  iplogsupload │  │
└─────────────────────┘         │  └───────────────┘  │
                                │          │          │
                                │          ▼          │
                                │  ┌───────────────┐  │
                                │  │ Firebird DB   │  │
                                │  │ (PanCafe)     │  │
                                │  └───────────────┘  │
                                └─────────────────────┘
```

## Firebase Paths Used

| Path | Purpose |
|------|---------|
| `/sync-control/request` | Write a timestamp here to trigger sync |
| `/sync-control/status` | Current status: `idle`, `syncing`, `completed`, `error`, `offline` |
| `/sync-control/progress` | Array of progress messages with timestamps |
| `/sync-control/last_sync` | Info about the last completed sync |
| `/sync-control/service_heartbeat` | Service health check (updated every 30s) |

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

You can download this from Firebase Console > Project Settings > Service Accounts > Generate New Private Key.

### 3. Start the Service

**Option A: Manual Start**
```bash
cd scripts
python sync_service.py
```

**Option B: Use Batch Script**
Double-click `start_sync_service.bat`

**Option C: Auto-Start on Windows Boot**
1. Press `Win+R`, type `shell:startup`
2. Create a shortcut to `start_sync_service.bat` in this folder

### 4. Trigger Sync from Web UI

1. Open the admin dashboard
2. Click "Sync Database" in the sidebar
3. Click "Full Sync" or individual sync buttons
4. Watch real-time progress in the modal

## How It Works

1. **Service Startup**: `sync_service.py` starts and updates its heartbeat in Firebase every 30 seconds.

2. **Sync Request**: When you click "Sync" in the web UI, it writes a unique request ID to `/sync-control/request`.

3. **Detection**: The service polls Firebase every 5 seconds. When it sees a new request ID, it starts the sync.

4. **Execution**: The service runs `fdbupload.py` and `iplogsupload.py`, capturing their output.

5. **Progress Updates**: Progress messages are written to `/sync-control/progress` in real-time.

6. **Completion**: Status is set to `completed` or `error`, and `/sync-control/last_sync` is updated.

7. **Web UI**: The dashboard polls Firebase and displays progress in real-time.

## Testing

Run a single sync manually:
```bash
python sync_service.py --test
```

## Troubleshooting

### Service shows as offline
- Check if `sync_service.py` is running
- Verify Firebase credentials are correct
- Check network connectivity

### Sync doesn't start
- Check service heartbeat (should update every 30s)
- Verify Firebase rules allow writing to `/sync-control`
- Check console for errors

### Progress not updating
- The service writes progress every few seconds
- Large syncs may take a while to show progress
- Check the service console for errors

## Files

| File | Purpose |
|------|---------|
| `sync_service.py` | Main service that monitors Firebase and runs syncs |
| `fdbupload.py` | Syncs PanCafe database (members, history, sessions) |
| `iplogsupload.py` | Processes IP logs and terminal status |
| `config.py` | Shared configuration for all scripts |
| `start_sync_service.bat` | Windows launcher script |

## Security Notes

- Firebase credentials should have write access to the FDB dataset database
- The service runs locally with access to the Firebird database
- Web UI only writes to `/sync-control/request` - cannot execute arbitrary code

