# 📊 OceanZ Firebase Data Structure & Usage Guide

## 🔥 Firebase Databases

We use **2 separate Firebase databases**:

| Database | Project ID | Purpose |
|----------|------------|---------|
| **Booking DB** | `gaming-cafe-booking` | Bookings, Recharges, Staff, Cash Register |
| **FDB (oceanz-fdb)** | `oceanz-fdb` | Members, History, Sessions, Leaderboards, Terminal Status |

---

## 📁 FDB Database Structure (`oceanz-fdb`)

### 1. `/members/{USERNAME}` - Member Profiles (V2 Structure)

**Written by:** `oceanz_sync.py` → `build_and_upload_optimized_members()`  
**Frequency:** Every 15 min (incremental - only changed members)

```json
{
  "profile": {
    "ID": 334,
    "USERNAME": "9731",
    "PASSWORD": "1234",
    "DISPLAY_NAME": "9731",
    "FIRSTNAME": "Rudra",
    "LASTNAME": "Mane",
    "EMAIL": "",
    "PHONE": "",
    "RECDATE": "2023-12-03",
    "LASTLOGIN": "2023-12-03",
    "MEMBERSTATE": 1,
    "PRICETYPE": 3
  },
  "balance": {
    "current_balance": 0,
    "total_loaded": 120,
    "total_spent": 120
  },
  "stats": {
    "total_minutes": 181,
    "total_hours": 3,
    "total_sessions": 0,
    "monthly_minutes": 0,
    "monthly_sessions": 0,
    "streak_days": 0,
    "last_active": "2023-12-03"
  },
  "ranks": {
    "all_time": 840,
    "monthly": null,
    "weekly": null
  },
  "badges": {
    "activity_status": "ghost",
    "ghost": true
  },
  "recent_history": [],
  "recent_sessions": [],
  "last_updated": "2026-01-16T22:34:13"
}
```

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `profile.ID` | int | Member ID from PanCafe |
| `profile.USERNAME` | string | Login username (UPPERCASE) |
| `profile.PASSWORD` | string | For member portal login |
| `profile.DISPLAY_NAME` | string | Display name (original case) |
| `profile.FIRSTNAME` | string | First name |
| `profile.LASTNAME` | string | Last name |
| `profile.EMAIL` | string | Email address |
| `profile.PHONE` | string | Phone number |
| `profile.RECDATE` | string | Registration date (YYYY-MM-DD) |
| `profile.LASTLOGIN` | string | Last login to PanCafe |
| `profile.MEMBERSTATE` | int | Account status (1=active) |
| `profile.PRICETYPE` | int | Pricing tier |
| `balance.current_balance` | float | Current ₹ balance |
| `balance.total_loaded` | float | Total ₹ ever loaded |
| `balance.total_spent` | float | Total ₹ spent |
| `stats.total_minutes` | int | Total playtime in minutes |
| `stats.total_hours` | float | Total playtime in hours |
| `stats.total_sessions` | int | Total session count |
| `stats.monthly_minutes` | int | Current month playtime |
| `stats.monthly_sessions` | int | Current month sessions |
| `stats.streak_days` | int | Consecutive days played |
| `stats.last_active` | string | Last activity date |
| `ranks.all_time` | int | All-time rank position |
| `ranks.monthly` | int | Monthly rank position |
| `ranks.weekly` | int | Weekly rank position |
| `badges.activity_status` | string | active/regular/ghost |
| `badges.*` | boolean | Various achievement badges |
| `recent_history` | array | Last 20 history entries |
| `recent_sessions` | array | Last 10 sessions |
| `last_updated` | string | Last sync timestamp |

#### UI Usage

| Field | Used In | Purpose |
|-------|---------|---------|
| `profile.USERNAME` | Member login | Authentication |
| `profile.PASSWORD` | Member login | Authentication |
| `profile.ID` | Member dashboard | Display member ID |
| `profile.FIRSTNAME/LASTNAME` | All member lists | Display name |
| `profile.RECDATE` | Member dashboard | "Member since" |
| `balance.current_balance` | Counter, Dashboard | Show balance |
| `stats.total_minutes` | Dashboard, Analytics | Activity stats |
| `stats.last_active` | Leaderboards | "Last active" date |
| `ranks.all_time` | Dashboard | Show user's rank |
| `badges.*` | Dashboard, Leaderboards | Badge display |

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Member Login | `once()` | `/members/{username}` | On login (1 call) |
| Admin Dashboard | `once()` via SharedCache | `/members` | Page load (cached 5 min) |
| Counter | `once()` via SharedCache | `/members` | Uses cache |
| Recharges | `once()` via SharedCache | `/members` | Uses cache |
| Analytics | `once()` via SharedCache | `/members` | Uses cache |

---

### 2. `/leaderboards/` - Pre-computed Leaderboards

**Written by:** `oceanz_sync.py` → `calculate_leaderboards_from_fdb()`  
**Frequency:** Every 15 min

#### `/leaderboards/all-time` (Array)

```json
[
  {
    "rank": 1,
    "username": "TOPPLAYER",
    "total_minutes": 50000,
    "total_hours": 833.3,
    "total_spent": 5000.00,
    "member_since": "2022-01-15",
    "member_id": 101,
    "last_active": "2026-01-18",
    "streak_days": 5,
    "badges": {
      "champion": true,
      "grinder": true
    }
  }
]
```

#### `/leaderboards/monthly/{YYYY-MM}` (Array)

```json
[
  {
    "username": "MONTHLYKING",
    "total_minutes": 3000,
    "sessions_count": 45,
    "total_spent": 800.00,
    "total_hours": 50.0
  }
]
```

#### `/leaderboards/weekly/{YYYY-Wxx}` (Array)

Same structure as monthly.

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `rank` | int | Position in leaderboard |
| `username` | string | Display name |
| `total_minutes` | int | Total playtime |
| `total_hours` | float | Total hours |
| `total_spent` | float | Total ₹ spent |
| `member_since` | string | Registration date |
| `member_id` | int | Member ID |
| `last_active` | string | Last activity date |
| `streak_days` | int | Current streak |
| `badges` | object | Earned badges |

#### UI Usage

| Path | Used In | Purpose |
|------|---------|---------|
| `/all-time` | Hall of Fame, Member Dashboard | Top players all-time |
| `/monthly/{month}` | Monthly Leaderboard | Monthly rankings |
| `/weekly/{week}` | Weekly Leaderboard | Weekly rankings |

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Member Dashboard | `once()` | `/leaderboards/all-time` | Tab open |
| Member Dashboard | `once()` | `/leaderboards/monthly/{month}` | Tab open |
| Member Dashboard | `once()` | `/leaderboards/weekly/{week}` | Tab open |
| Shared Leaderboard | `once()` | `/leaderboards/monthly` (keys only) | Dropdown |

---

### 3. `/terminal-status/{TERMINAL_NAME}` - PC Status

**Written by:** `oceanz_sync.py` → `process_and_upload_terminal_status()`  
**Frequency:** Every 1-2 min (quick sync)

```json
{
  "CT-ROOM-1": {
    "status": "busy",
    "member": "PLAYERNAME",
    "member_id": 123,
    "start_time": "2026-01-18T14:30:00",
    "elapsed_minutes": 45,
    "last_updated": "2026-01-18T15:15:00"
  }
}
```

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | idle/busy/offline |
| `member` | string | Current user's username |
| `member_id` | int | Current user's ID |
| `start_time` | string | Session start time |
| `elapsed_minutes` | int | Session duration |
| `last_updated` | string | Last update timestamp |

#### UI Usage

| Field | Used In | Purpose |
|-------|---------|---------|
| `status` | Admin Dashboard | PC status grid color |
| `member` | Admin Dashboard | Show who's playing |
| `elapsed_minutes` | Admin Dashboard | Session duration display |

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Admin Dashboard | `onValue()` listener | `/terminal-status` | Real-time updates |

---

### 4. `/history/{USERNAME}/{ID}` - Member History Archive

**Written by:** `oceanz_sync.py` → `process_and_upload_history()`  
**Frequency:** Every 15 min (incremental)

```json
{
  "12345": {
    "ID": 12345,
    "DATE": "2026-01-18",
    "TIME": "14:30:00",
    "CHARGE": -50.00,
    "BALANCE": 150.00,
    "NOTE": "Session",
    "TERMINALNAME": "CT-ROOM-1",
    "TERMINAL_SHORT": "CT1",
    "USINGMIN": 60,
    "USINGSEC": 0,
    "DISCOUNTNOTE": ""
  }
}
```

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `ID` | int | History entry ID |
| `DATE` | string | Entry date (YYYY-MM-DD) |
| `TIME` | string | Entry time (HH:MM:SS) |
| `CHARGE` | float | Amount (negative=spent, positive=loaded) |
| `BALANCE` | float | Balance after transaction |
| `NOTE` | string | Transaction note |
| `TERMINALNAME` | string | PC name (full) |
| `TERMINAL_SHORT` | string | PC name (short) |
| `USINGMIN` | int | Session minutes |
| `USINGSEC` | int | Session seconds |
| `DISCOUNTNOTE` | string | Discount info |

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Member Dashboard | `once()` limitToLast(50) | `/history/{username}` | History tab |

---

### 5. `/history-by-date/{YYYY-MM-DD}/{ID}` - Date-indexed History

**Written by:** `oceanz_sync.py` → `process_and_upload_history()`  
**Purpose:** Efficient date-based queries

```json
{
  "2026-01-18": {
    "12345": {
      "USERNAME": "PLAYER1",
      "CHARGE": -50.00,
      "TERMINALNAME": "CT-ROOM-1"
    }
  }
}
```

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Recharges (Attendance) | `once()` | `/history-by-date/{date}` | Attendance tab |

---

### 6. `/sessions/{SESSION_ID}` - Active Sessions

**Written by:** `oceanz_sync.py` → `process_and_upload_sessions()`  
**Frequency:** Every 15 min

```json
{
  "session_123": {
    "MEMBERID": 123,
    "TERMINALNAME": "CT-ROOM-1",
    "STARTPOINT": "2026-01-18T14:00:00",
    "ENDPOINT": null,
    "USINGMIN": 60,
    "TOTALPRICE": 40.00
  }
}
```

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `MEMBERID` | int | Member ID |
| `TERMINALNAME` | string | PC name |
| `STARTPOINT` | string | Session start time |
| `ENDPOINT` | string/null | Session end time (null=active) |
| `USINGMIN` | int | Duration in minutes |
| `TOTALPRICE` | float | Session cost |

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Admin Dashboard | `onValue()` listener | `/sessions` | Real-time |

---

### 7. `/guest-sessions/{YYYY-MM-DD}/{key}` - Guest Sessions

**Written by:** `oceanz_sync.py` → `upload_guest_sessions()`  
**Source:** Parsed from `messages.msg` file

```json
{
  "2026-01-18": {
    "CT1_1430": {
      "terminal": "CT-ROOM-1",
      "start_time": "14:30",
      "end_time": "15:30",
      "duration_minutes": 60,
      "amount": 40
    }
  }
}
```

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Recharges (Attendance) | `once()` | `/guest-sessions/{date}` | Attendance tab |
| Analytics | `once()` limitToLast(200) | `/guest-sessions` | Analytics load |

---

### 8. `/sync-control/` - Sync Management

**Written by:** `sync_service.py` and `oceanz_sync.py`  
**Purpose:** Remote sync triggering and status

```json
{
  "request": "2026-01-18T15:00:00",
  "status": "idle",
  "progress": ["Step 1 done", "Step 2..."],
  "last_sync": {
    "timestamp": "2026-01-18T15:05:00",
    "duration_seconds": 45.2,
    "success": true
  },
  "service_heartbeat": "2026-01-18T15:10:00"
}
```

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `request` | string | Timestamp to trigger sync |
| `status` | string | idle/syncing/completed/error |
| `progress` | array | Progress messages |
| `last_sync.timestamp` | string | Last sync time |
| `last_sync.duration_seconds` | float | Sync duration |
| `last_sync.success` | boolean | Success status |
| `service_heartbeat` | string | Service health check |

#### UI Usage

| Field | Used In | Purpose |
|-------|---------|---------|
| `request` | Admin Dashboard | Trigger manual sync |
| `status` | Admin Dashboard | Show sync status |
| `last_sync` | Admin Dashboard | Last sync info |

---

### 9. `/daily-summary/{YYYY-MM-DD}` - Aggregated Daily Stats

**Written by:** `oceanz_sync.py` → `process_and_upload_history()`

```json
{
  "by_member": {
    "PLAYER1": {
      "total_charge": 150.00,
      "session_count": 3,
      "total_minutes": 180
    }
  },
  "totals": {
    "revenue": 5000.00,
    "sessions": 50,
    "unique_members": 25
  }
}
```

---

### 10. `/cash-register/{YYYY-MM-DD}` - Daily Cash Register (KASAHAR)

**Written by:** `oceanz_sync.py` → `process_and_upload_kasahar()`

```json
{
  "transactions": [
    {
      "time": "10:30:00",
      "amount": 500.00,
      "type": "IN",
      "note": "Opening balance"
    }
  ],
  "summary": {
    "total_in": 5000.00,
    "total_out": 500.00,
    "net": 4500.00
  }
}
```

---

## 📁 Booking Database Structure (`gaming-cafe-booking`)

### 1. `/recharges/{YYYY-MM-DD}/{ID}` - Recharge Entries

**Written by:** Admin UI (recharges.js)  
**Real-time listener:** Yes

```json
{
  "recharge_abc123": {
    "member": "PLAYER1",
    "amount": 100,
    "method": "cash",
    "admin": "Staff Name",
    "timestamp": "2026-01-18T14:30:00",
    "terminal": "CT-ROOM-1",
    "note": "",
    "status": "paid",
    "creditPayments": [],
    "lastPaidAt": null,
    "lastPaidBy": null
  }
}
```

#### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `member` | string | Member username or "GUEST" |
| `amount` | int | Recharge amount in ₹ |
| `method` | string | cash/upi/credit/free |
| `admin` | string | Staff who processed |
| `timestamp` | string | Transaction time |
| `terminal` | string | PC name (for guests) |
| `note` | string | Optional note |
| `status` | string | paid/pending |
| `creditPayments` | array | Payment history (credit) |
| `lastPaidAt` | string | Last payment time |
| `lastPaidBy` | string | Who collected payment |

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Recharges | `onValue()` listener | `/recharges/{today}` | Real-time |
| Recharges | `once()` via SharedCache | `/recharges` | Monthly report |
| Cash Register | `once()` via SharedCache | `/recharges` | Daily totals |
| Analytics | `once()` via SharedCache | `/recharges` | Uses cache |

---

### 2. `/bookings/{BOOKING_ID}` - PC Bookings

**Written by:** Member Portal & Admin UI

```json
{
  "booking_xyz": {
    "member": "PLAYER1",
    "pc": "CT1",
    "date": "2026-01-18",
    "startTime": "14:00",
    "endTime": "16:00",
    "status": "confirmed",
    "createdAt": "2026-01-17T10:00:00"
  }
}
```

#### Firebase Calls

| Page | Call Type | Path | When |
|------|-----------|------|------|
| Admin Dashboard | `onValue()` listener | `/bookings` | Real-time |
| Member Dashboard | `once()` | `/bookings` | Check availability |

---

### 3. `/cash_register/{YYYY-MM-DD}` - Manual Cash Register

**Written by:** Admin UI (cash-register.js)

```json
{
  "opening": 5000,
  "closing": 8500,
  "denominations": {
    "2000": 1,
    "500": 5,
    "200": 5,
    "100": 10
  },
  "notes": "Good day",
  "admin": "Staff Name"
}
```

---

### 4. `/staff/{STAFF_ID}` - Staff Management

```json
{
  "staff_abc": {
    "name": "John",
    "email": "john@example.com",
    "role": "admin",
    "active": true,
    "permissions": ["recharges", "bookings"]
  }
}
```

---

### 5. `/recharge_audit/{ID}` - Audit Log

**Written by:** Admin UI on edits/deletes

```json
{
  "audit_123": {
    "action": "edit",
    "rechargeId": "recharge_abc",
    "before": {},
    "after": {},
    "admin": "Staff Name",
    "timestamp": "2026-01-18T15:00:00"
  }
}
```

---

## 📊 Firebase Call Summary

### Per Page Firebase Calls

| Page | Total Calls | Details |
|------|-------------|---------|
| **Member Login** | 1 | Single member lookup |
| **Member Dashboard** | 3-5 | Leaderboards (3), History (1), Bookings (1) |
| **Admin Dashboard** | 3 | Members (cached), Terminals (listener), Sessions (listener) |
| **Counter** | 1 | Members (cached) |
| **Recharges** | 2-4 | Members (cached), Recharges (listener), Guest sessions, History-by-date |
| **Analytics** | 3 | Members (cached), Recharges (cached), Sessions |
| **Cash Register** | 2 | Cash register entries, Recharges (cached) |

### SharedCache Benefits

| Data | Without Cache | With Cache |
|------|---------------|------------|
| `/members` | 4 calls (~1.6 MB) | 1 call (~400 KB) |
| `/recharges` | 3 calls (~1.5 MB) | 1 call (~500 KB) |

### Real-time Listeners (Always Active)

| Path | Page | Purpose |
|------|------|---------|
| `/terminal-status` | Admin Dashboard | PC status grid |
| `/sessions` | Admin Dashboard | Active sessions |
| `/bookings` | Admin Dashboard | Booking updates |
| `/recharges/{today}` | Recharges | Today's transactions |

---

## 📈 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SYNC SCRIPT (Python)                          │
│                     Runs every 1-15 minutes                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Firebird DB (usdb.dat)                                             │
│       │                                                              │
│       ├─→ MEMBERS table ──────→ /members/{username}                 │
│       │                         /leaderboards/all-time              │
│       │                                                              │
│       ├─→ MEMBERSHISTORY ─────→ /history/{username}/{id}            │
│       │                         /history-by-date/{date}/{id}         │
│       │                         /daily-summary/{date}                │
│       │                         /leaderboards/monthly/{month}        │
│       │                         /leaderboards/weekly/{week}          │
│       │                                                              │
│       ├─→ SESSIONS table ─────→ /sessions/{id}                      │
│       │                         /terminal-status/{pc}                │
│       │                                                              │
│       ├─→ KASAHAR table ──────→ /cash-register/{date}               │
│       │                                                              │
│       └─→ messages.msg ───────→ /guest-sessions/{date}              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         WEB UI (JavaScript)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Admin Dashboard                                                     │
│       ├─← /members (SharedCache) ─────── Member list, search        │
│       ├─← /terminal-status (listener) ── PC status grid             │
│       ├─← /sessions (listener) ───────── Active sessions            │
│       └─← /bookings (listener) ───────── Booking calendar           │
│                                                                      │
│  Recharges Page                                                      │
│       ├─← /members (SharedCache) ─────── Autocomplete               │
│       ├─← /recharges/{date} (listener) ─ Today's transactions       │
│       ├─← /recharges (SharedCache) ───── Monthly reports            │
│       ├─← /guest-sessions/{date} ─────── Guest attendance           │
│       └─← /history-by-date/{date} ────── Member attendance          │
│                                                                      │
│  Member Portal                                                       │
│       ├─← /members/{username} ────────── Login (single lookup!)     │
│       ├─← /leaderboards/all-time ─────── Hall of Fame               │
│       ├─← /leaderboards/monthly/{m} ──── Monthly leaderboard        │
│       ├─← /leaderboards/weekly/{w} ───── Weekly leaderboard         │
│       ├─← /history/{username} ────────── History tab                │
│       └─← /bookings ──────────────────── Check availability         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 💾 Estimated Data Sizes

| Path | Entries | Est. Size |
|------|---------|-----------|
| `/members` | ~1000 members | 400-600 KB |
| `/leaderboards/all-time` | ~1000 entries | 50-100 KB |
| `/leaderboards/monthly/{m}` | ~100-200 entries | 10-20 KB |
| `/history/{user}` | 50-1000 per user | 5-50 KB each |
| `/recharges` | ~30 days × ~50/day | 100-500 KB |
| `/terminal-status` | ~15 PCs | 2-5 KB |

---

## ✅ Optimization Summary

| Optimization | Benefit |
|--------------|---------|
| **Single-key member lookup** | 1 call instead of scanning all members |
| **Pre-computed leaderboards** | No client-side calculation needed |
| **SharedCache** | Prevents duplicate downloads across pages |
| **Incremental member sync** | Only uploads changed members |
| **Pre-computed badges/streaks** | No history fetching for leaderboards |
| **Real-time listeners** | Only where truly needed |

---

## 🔧 Sync Script Schedule

| Sync Type | Frequency | Data Updated |
|-----------|-----------|--------------|
| **Terminal Sync** | Every 1-2 min | `/terminal-status` |
| **FDB Sync** | Every 15 min | Members, History, Leaderboards, Cash Register |

---

## 📝 Notes

1. **Firebase Security Rules**: FDB database is read-only from web (write via Admin SDK only)
2. **Data Retention**: History older than 30 days is archived but not deleted
3. **Cache TTL**: Members (5 min), Recharges (3 min), Sessions (5 min)
4. **Real-time vs Once**: Use `onValue()` only for data that changes frequently during a session
