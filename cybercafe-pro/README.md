# 🎮 CyberCafe Pro

A modern, lightweight cyber cafe management system built with Node.js and JSON-based database.

## ✨ Features

- 👤 **Member Management** - Register, track balances, packages
- 💻 **PC Monitoring** - Real-time status of all computers
- ⏱️ **Session Tracking** - Automatic time and billing
- 💰 **Billing System** - Flexible rates, packages, prepaid
- 📊 **Reports & Analytics** - Daily, weekly, monthly reports
- 🔐 **Staff Management** - Role-based access control
- 📱 **Responsive Dashboard** - Works on any device

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Initialize database with sample data
npm run init-db

# Start the server
npm start

# For development (auto-reload)
npm run dev
```

Server runs at: `http://localhost:3000`
Admin Panel: `http://localhost:3000/admin`

## 📁 Project Structure

```
cybercafe-pro/
├── server/           # Backend API server
│   ├── index.js      # Main server entry
│   ├── routes/       # API routes
│   ├── middleware/   # Auth, validation
│   └── init-db.js    # Database initializer
├── admin/            # Admin dashboard (web)
├── client/           # Member portal (web)
├── pc-client/        # Desktop client for PCs
├── shared/           # Shared utilities
└── data/             # JSON database files
    ├── members.json
    ├── sessions.json
    ├── computers.json
    ├── transactions.json
    ├── staff.json
    └── settings.json
```

## 🔧 Configuration

Edit `data/settings.json` to customize:
- Hourly rates
- Packages
- Business hours
- Tax settings

## 📡 API Endpoints

### Members
- `GET /api/members` - List all members
- `POST /api/members` - Create member
- `GET /api/members/:id` - Get member details
- `PUT /api/members/:id` - Update member
- `POST /api/members/:id/recharge` - Add balance

### Sessions
- `POST /api/sessions/start` - Start session
- `POST /api/sessions/end` - End session
- `GET /api/sessions/active` - Get active sessions

### Computers
- `GET /api/computers` - List all PCs
- `PUT /api/computers/:id/status` - Update PC status

### Reports
- `GET /api/reports/daily` - Daily summary
- `GET /api/reports/monthly` - Monthly summary

## 🔐 Default Login

```
Admin: admin / admin123
Staff: staff / staff123
```

## 📄 License

MIT License - Feel free to use and modify!
