# OceanZ Firebase Database - Optimized Schema Design

## Design Goals

1. **Single-Key Lookup**: Get all member data with one Firebase read
2. **Pre-Computed Data**: All aggregations done during sync, not on client
3. **Minimal Downloads**: Only fetch what's needed for each view
4. **Real-time Updates**: Support live terminal status updates
5. **Efficient Queries**: Index-friendly structure for Firebase

---

## Database Structure

```
oceanz-db/
├── members/{username}/              # Complete member profile (MAIN READ PATH)
│   ├── profile/                     # Basic info
│   │   ├── id
│   │   ├── username
│   │   ├── display_name
│   │   ├── password_hash
│   │   ├── firstname
│   │   ├── lastname
│   │   ├── email
│   │   ├── phone
│   │   ├── member_since
│   │   ├── last_login
│   │   ├── status (active/disabled)
│   │   └── avatar_url
│   │
│   ├── balance/                     # Financial info
│   │   ├── current                  # Current balance (BAKIYE)
│   │   ├── total_loaded             # Total ever loaded (TOTALBAKIYE)
│   │   └── total_spent              # Pre-computed total spent
│   │
│   ├── stats/                       # Pre-computed lifetime stats
│   │   ├── total_minutes            # Total active minutes
│   │   ├── total_hours              # Computed: minutes/60
│   │   ├── total_sessions           # Number of sessions ever
│   │   ├── total_recharges          # Number of recharges
│   │   ├── favorite_terminal        # Most used PC
│   │   ├── avg_session_minutes      # Average session length
│   │   └── last_activity_date       # Last session/recharge date
│   │
│   ├── ranks/                       # Pre-computed rankings
│   │   ├── all_time                 # Overall rank
│   │   ├── monthly                  # Current month rank
│   │   ├── weekly                   # Current week rank
│   │   └── percentile               # Top X%
│   │
│   ├── badges/                      # Pre-computed badges
│   │   ├── champion                 # bool - #1 all time
│   │   ├── grinder                  # bool - top 5 this month
│   │   ├── big_spender              # bool - top spender
│   │   ├── streak_days              # Current streak count
│   │   ├── streak_badge             # "🔥" if streak > 0
│   │   └── activity_status          # "active"/"inactive"/"ghost"
│   │
│   ├── recent_history/              # Last 20 history entries (for quick display)
│   │   └── {entry_id}: { date, time, charge, balance, note, terminal }
│   │
│   └── recent_sessions/             # Last 10 sessions (for quick display)
│       └── {session_id}: { date, duration, terminal, price }
│
├── terminals/{terminal_name}/       # Real-time terminal status
│   ├── status                       # available/occupied/offline/maintenance
│   ├── status_code                  # 0-6
│   ├── last_updated                 # ISO timestamp
│   ├── mac_address
│   │
│   │   # If occupied:
│   ├── session/
│   │   ├── member_id               # 0 = guest
│   │   ├── member_username
│   │   ├── is_guest
│   │   ├── start_time
│   │   ├── duration_minutes        # Running duration
│   │   ├── timer_minutes           # Timer limit (if timed)
│   │   ├── remaining_minutes       # Timer remaining
│   │   ├── session_type            # timed/unlimited
│   │   ├── session_price
│   │   └── started_by              # Admin name
│
├── leaderboards/                    # Pre-computed leaderboards
│   ├── all-time/                    # Array of top N members
│   │   └── [{ rank, username, total_minutes, total_hours, member_since }]
│   │
│   ├── monthly/{YYYY-MM}/           # Monthly leaderboard
│   │   └── [{ rank, username, total_minutes, sessions_count, total_spent }]
│   │
│   └── weekly/{YYYY-Wxx}/           # Weekly leaderboard
│       └── [{ rank, username, total_minutes, sessions_count }]
│
├── daily-stats/{YYYY-MM-DD}/        # Daily aggregated stats
│   ├── summary/
│   │   ├── total_revenue
│   │   ├── total_recharges
│   │   ├── total_sessions
│   │   ├── guest_sessions
│   │   ├── guest_revenue
│   │   ├── unique_members
│   │   ├── busiest_hour
│   │   └── most_used_terminal
│   │
│   ├── revenue/
│   │   ├── total_income
│   │   ├── total_expense
│   │   ├── net_revenue
│   │   ├── by_type/                 # session, recharge, cafeteria
│   │   └── by_payment/              # cash, card, balance
│   │
│   └── guest_sessions/              # Guest session details
│       └── {terminal_time}: { terminal, duration, price }
│
├── history-archive/{YYYY-MM}/       # Full history archive (for detailed queries)
│   └── {username}/
│       └── {entry_id}: { full history entry }
│
├── sync-control/                    # Sync service control
│   ├── request                      # Timestamp to trigger sync
│   ├── status                       # idle/syncing/completed/error
│   ├── progress                     # Progress messages
│   ├── last_sync                    # Last sync info
│   ├── schedule                     # Next scheduled syncs
│   └── service_heartbeat            # Service health
│
└── meta/                            # Database metadata
    ├── last_updated
    ├── schema_version
    ├── member_count
    └── stats_computed_at
```

---

## Key Optimizations

### 1. Single-Key Member Lookup
```javascript
// OLD: Multiple calls needed
const profile = await db.ref(`members/${username}`).get();
const history = await db.ref(`history/${username}`).get();
const sessions = await db.ref(`sessions-by-member/${memberId}`).get();
const leaderboard = await db.ref(`leaderboards/all-time`).get();
// Then compute rank, streak, badges on client...

// NEW: Everything in one call
const member = await db.ref(`members/${username}`).get();
// Contains: profile, balance, stats, ranks, badges, recent_history, recent_sessions
```

### 2. Pre-Computed Stats & Badges
All computed during sync from Firebird DB:
- Total minutes/hours
- Favorite terminal
- Average session length
- Streak calculation
- Rank positions
- Badge eligibility

### 3. Leaderboard Efficiency
- Pre-sorted arrays with rank included
- Client just renders, no sorting needed
- Member's rank stored in their profile

### 4. Recent Data for Quick Display
- Last 20 history entries embedded in member profile
- Last 10 sessions embedded
- No separate query needed for dashboard

### 5. Archive for Full History
- Full history in monthly archives
- Only fetched when "View All" is clicked
- Not loaded by default

---

## Firebase Security Rules

```json
{
  "rules": {
    "members": {
      "$username": {
        ".read": "auth != null && (auth.token.admin === true || $username === auth.token.username)",
        ".write": false
      },
      ".indexOn": ["profile/id", "stats/total_minutes"]
    },
    "terminals": {
      ".read": "auth != null",
      ".write": false
    },
    "leaderboards": {
      ".read": "auth != null",
      ".write": false
    },
    "daily-stats": {
      "$date": {
        ".read": "auth != null && auth.token.admin === true",
        ".write": false
      }
    },
    "history-archive": {
      "$month": {
        "$username": {
          ".read": "auth != null && (auth.token.admin === true || $username === auth.token.username)",
          ".write": false
        }
      }
    },
    "sync-control": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.admin === true"
    },
    "meta": {
      ".read": true,
      ".write": false
    }
  }
}
```

---

## Migration Path

1. **Create new Firebase project** with new structure
2. **Update sync script** to compute and upload optimized data
3. **Update frontend** to use new paths
4. **Parallel run** both databases during transition
5. **Switch over** once validated
6. **Archive old database**

---

## Bandwidth Comparison

| Operation | Old Structure | New Structure | Reduction |
|-----------|--------------|---------------|-----------|
| Member dashboard load | ~500KB (5+ calls) | ~20KB (1 call) | 96% |
| Leaderboard view | ~200KB + client compute | ~15KB ready-to-render | 92% |
| Terminal status | ~10KB | ~10KB | Same |
| Full history (rare) | ~1MB | ~1MB (archived) | Same |

**Estimated daily download**: 50-100MB (vs 4GB before optimizations)
