# 🎮 OceanZ Gaming Cafe 

A modern, full-featured management system for gaming cafes built with vanilla JavaScript, Firebase, and Python. Features real-time terminal monitoring, member management, booking system, financial tracking, and leaderboards.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20PWA-brightgreen.svg)
![Firebase](https://img.shields.io/badge/backend-Firebase-orange.svg)

---

## ✨ Features

### 🖥️ Admin Dashboard
- **Real-time Terminal Monitoring** - Live status of all gaming PCs, Xbox, and PlayStation
- **Member Management** - Search, view history, and manage member accounts
- **Booking System** - Approve/decline PC, Xbox, and PS bookings with visual timetable
- **Recharge Management** - Split payments (Cash/UPI/Credit), credit collection tracking
- **Cash Register** - Daily cash tracking with denomination breakdown
- **Staff Management** - Role-based access control (Admin, Manager, Staff, Finance)
- **Analytics** - Usage statistics, revenue charts, and reports
- **PDF Export** - Generate professional reports for bookings, recharges, and cash register

### 👤 Member Portal
- **Personal Dashboard** - View balance, session history, and stats
- **Booking System** - Book PCs, Xbox (₹60/hr), or PlayStation (₹100/hr)
- **Leaderboards** - All-time, monthly, and weekly rankings
- **Activity History** - Detailed session and transaction history
- **Charts & Analytics** - Personal usage patterns and spending

### 🍔 Food / Snacks
- **Recharges page** - Add food sales against a **member or PC name** (same ledger as POS)
- **Counter POS** - Quick walk-in / counter food sales
- **Food Analytics** - Sales, cash/UPI, credits, top items
- **Finance & Analytics** - Food revenue folded into cafe totals; food stock expenses (`food_purchase`, `food_supplies`) with food margin

### 🔄 Sync Service (Python)
- **Automatic Sync** - Syncs PanCafe Firebird database to Firebase
- **Terminal Status** - Real-time PC status every 2 minutes
- **Leaderboard Calculation** - Auto-updates rankings every 15 minutes
- **Web UI Control** - Trigger manual syncs from admin dashboard

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Application                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Admin Portal │  │Member Portal │  │   Shared Modules     │  │
│  │  /admin/     │  │  /member/    │  │ config, utils, etc.  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └─────────────────┴──────────────────────┘              │
│                           │                                      │
│                    Firebase Realtime DB                          │
│         ┌─────────────────┴─────────────────┐                   │
│         │  booking-db  │  oceanz-fdb        │                   │
│         │  (bookings,  │  (members, history,│                   │
│         │   recharges) │   sessions, etc.)  │                   │
│         └─────────────────┬─────────────────┘                   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│           Sync Service (Python - runs on FDB server)            │
│                           │                                      │
│    ┌──────────────────────┴──────────────────────┐              │
│    │              sync_service.py                 │              │
│    │  - Monitors Firebase for sync requests       │              │
│    │  - Auto-syncs terminals every 2 min          │              │
│    │  - Auto-syncs FDB data every 15 min          │              │
│    └──────────────────────┬──────────────────────┘              │
│                           │                                      │
│    ┌──────────────────────┴──────────────────────┐              │
│    │         PanCafe Firebird Database           │              │
│    │  (MEMBERS, SESSIONS, TERMINALS, etc.)       │              │
│    └─────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
oceanz0604.github.io/
├── index.html                 # Landing page (redirects to member login)
├── sw.js                      # Service worker for PWA
├── manifest.webmanifest       # PWA manifest
├── offline.html               # Offline fallback page
│
├── admin/                     # Admin portal
│   ├── index.html             # Admin login
│   ├── dashboard.html         # Main admin dashboard (all features)
│   ├── counter.html           # Quick POS terminal
│   └── js/
│       ├── dashboard.js       # Dashboard logic & terminal monitoring
│       ├── bookings.js        # Booking management & timetable
│       ├── recharges.js       # Recharge & credit management
│       ├── cash-register.js   # Daily cash tracking
│       ├── staff.js           # Staff management
│       ├── history.js         # Member history lookup
│       ├── finance.js         # Finance P&L, expenses & insights
│       ├── food-stock.js      # Food inventory & purchases → expenses
│       ├── food-menu.js       # Cafe menu CRUD
│       ├── food-analytics.js  # Food sales analytics
│       ├── counter.js         # POS terminal logic
│       └── permissions.js     # Role-based access control
│
├── member/                    # Member portal
│   ├── login.html             # Member login page
│   ├── dashboard.html         # Member dashboard
│   └── js/
│       ├── login.js           # Login authentication
│       └── dashboard.js       # Dashboard, bookings, leaderboards
│
├── shared/                    # Shared modules
│   ├── config.js              # Firebase config & constants
│   ├── firebase.js            # Firebase utilities
│   ├── utils.js               # Common utilities (IST time, formatting)
│   ├── leaderboard.js         # Leaderboard display functions
│   ├── member-search.js       # Member search autocomplete
│   ├── notify.js              # Toast notifications
│   ├── pdf-export.js          # PDF generation utilities
│   └── styles.css             # Shared styles
│
├── assets/
│   ├── css/
│   │   ├── admin.css          # Admin-specific styles
│   │   ├── member.css         # Member-specific styles
│   │   └── common.css         # Common styles
│   └── icons/                 # App icons
│
├── scripts/                   # Python sync service
│   ├── config.py              # Python configuration
│   ├── oceanz_sync.py         # Main sync logic (FDB → Firebase)
│   ├── sync_service.py        # Background service with scheduling
│   ├── inspect_fdb.py         # Database inspection utility
│   ├── setup_sync_service.bat # One-time Windows setup
│   ├── start_sync_service.bat # Start sync service
│   └── uninstall_sync_service.bat
│
└── firebase-rules/            # Firebase security rules
    ├── booking-db-rules.json
    └── oceanz-fdb-rules.json
```

---

## 🚀 Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Edge)
- Firebase project with Realtime Database
- Python 3.8+ (for sync service)
- PanCafe Pro with Firebird database (for sync)

### 1. Firebase Setup

1. Create two Firebase Realtime Databases:
   - `booking-db` - For bookings, recharges, staff, cash register
   - `oceanz-fdb` - For synced member data, sessions, leaderboards

2. Update Firebase config in `shared/config.js`:
```javascript
export const BOOKING_DB_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-booking-db.firebaseio.com",
  projectId: "your-project",
  // ...
};

export const FDB_DATASET_CONFIG = {
  // ... similar config for oceanz-fdb
};
```

3. Deploy Firebase security rules from `firebase-rules/`

### 2. Web Application

Simply host the files on any static web server:
- GitHub Pages
- Netlify
- Vercel
- Any web server (Apache, Nginx)

The app is a static PWA - no server-side processing required.

### 3. Sync Service Setup (Windows)

On the machine running PanCafe/Firebird:

```batch
# 1. Copy scripts to C:\oceanz0604.github.io\scripts

# 2. Update config.py with your paths:
#    - FIREBASE_CRED_PATH (service account JSON)
#    - FDB_PATH (Firebird database path)
#    - MESSAGES_PATH (PanCafe messages file)

# 3. Run setup (as Administrator):
setup_sync_service.bat

# The service will now auto-start on every boot!
```

#### Manual Commands:
```batch
# Start manually
start_sync_service.bat

# Test single sync
python sync_service.py --test

# Uninstall auto-start
uninstall_sync_service.bat
```

---

## 🔧 Configuration

### Device Pricing (`shared/config.js`)
```javascript
RATES: {
  PC: 40,      // ₹40/hour
  XBOX: 60,    // ₹60/hour
  PS: 100      // ₹100/hour
}
```

### Sync Intervals (`scripts/sync_service.py`)
```python
TERMINALS_INTERVAL = 2   # Minutes between terminal status syncs
FDB_INTERVAL = 15        # Minutes between full database syncs
```

### Staff Roles (`admin/js/permissions.js`)
| Role | Permissions |
|------|-------------|
| Admin | Full access to all features |
| Manager | All except staff management |
| Staff | Recharges, history, bookings |
| Finance | View-only access (no edits) |

---

## 📱 PWA Features

- **Installable** - Add to home screen on mobile/desktop
- **Offline Support** - Basic offline page when network unavailable
- **Responsive** - Works on all screen sizes
- **Fast** - Service worker caching for assets

---

## 🔥 Firebase Data Structure

### booking-db
```
├── bookings/
│   └── {booking-id}/
│       ├── name, deviceType, pcs[], start, end, price, status
├── recharges/
│   └── {date}/
│       └── {recharge-id}/
│           ├── member, total, cash, upi, credit, createdAt
├── cash_register/
│   └── {date}/
│       ├── opening, closing, sale, withdrawal, denominations
├── staff/
│   └── {email-key}/
│       ├── name, email, role, permissions
└── audit/
    └── {date}/
        └── {log-id}/ (action logs)
```

### oceanz-fdb
```
├── members/
│   └── {username}/
│       ├── USERNAME, FIRSTNAME, BALANCE, TOTALACTMINUTE, etc.
├── history/
│   └── {username}/
│       └── {record-id}/ (session/transaction history)
├── sessions/
│   └── {session-id}/ (active/recent sessions)
├── terminals/
│   └── {terminal-name}/
│       ├── status, member_id, session_start, etc.
├── leaderboards/
│   ├── all-time/{username}: {total_minutes, sessions, rank}
│   ├── monthly/{YYYY-MM}/[array of rankings]
│   └── weekly/{YYYY-Www}/[array of rankings]
└── sync-control/
    ├── status, progress[], last_sync, schedule
```

---

## 🎨 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JavaScript, Tailwind CSS |
| Backend | Firebase Realtime Database |
| Sync | Python 3, firebase-admin, fdb |
| Charts | Chart.js |
| PDF | jsPDF, jspdf-autotable |
| Icons | Lucide Icons |
| Fonts | Orbitron, Inter |

---

## 📄 License

MIT License - feel free to use this project for your own gaming cafe!

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

---

## 📞 Support

For questions or support, please open an issue on GitHub.

---

<p align="center">
  Made with ❤️ for <b>OceanZ Gaming Cafe</b>
</p>
