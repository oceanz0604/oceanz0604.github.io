# 🎮 CyberCafe Manager

A modern, full-featured cyber cafe management system built with Node.js and JSON-based database storage.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### 🖥️ Terminal Management
- Real-time terminal status monitoring
- Support for PCs, Xbox, and PlayStation
- Visual grid display with status indicators
- Maintenance mode support

### 👥 Member Management
- Member registration and authentication
- Balance tracking and recharge
- Session history and statistics
- Leaderboard rankings

### ⏱️ Session Tracking
- Start/end sessions with automatic billing
- Guest session support
- Per-minute billing calculation
- Device-specific rates

### 📅 Booking System
- Advance slot booking
- Conflict detection
- Booking confirmation/cancellation

### 📊 Reports & Analytics
- Daily/monthly revenue tracking
- Session statistics
- Leaderboard (all-time, monthly, weekly)
- Data export/backup

### 🔄 Real-time Updates
- WebSocket-based live updates
- Instant terminal status changes
- Live session monitoring

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Navigate to the project
cd cybercafe-manager

# Install dependencies
npm install

# Initialize database with sample data
npm run init-db

# Start the server
npm start
```

### Access Points
- **Home**: http://localhost:3000
- **Admin Dashboard**: http://localhost:3000/admin
- **Member Portal**: http://localhost:3000/member

### Default Credentials

**Admin:**
- Username: `admin`
- Password: `admin123`

**Sample Members:**
- Username: `saish0007` / Password: `member123`
- Username: `player1` / Password: `member123`

## 📁 Project Structure

```
cybercafe-manager/
├── server/
│   ├── index.js           # Main Express server
│   ├── db/
│   │   ├── db.js          # Database layer (LowDB)
│   │   ├── init.js        # Database initialization
│   │   └── database.json  # JSON database file
│   └── routes/
│       ├── auth.js        # Authentication
│       ├── members.js     # Member CRUD
│       ├── sessions.js    # Session management
│       ├── terminals.js   # Terminal management
│       ├── bookings.js    # Booking management
│       └── stats.js       # Statistics & reports
├── public/
│   ├── index.html         # Landing page
│   ├── admin/
│   │   ├── index.html     # Admin dashboard
│   │   └── js/admin.js    # Admin logic
│   ├── member/
│   │   ├── index.html     # Member portal
│   │   └── js/member.js   # Member logic
│   └── assets/
│       └── css/styles.css # Global styles
└── package.json
```

## 🔧 Configuration

### Pricing (in Settings)
| Device | Default Rate |
|--------|-------------|
| Gaming PC | ₹40/hour |
| Xbox | ₹60/hour |
| PlayStation | ₹100/hour |

### Operating Hours
- Default: 10:00 AM - 11:00 PM
- Configurable via Admin Dashboard > Settings

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/admin/login` | Admin login |
| POST | `/api/auth/member/login` | Member login |
| POST | `/api/auth/member/register` | Register member |
| GET | `/api/auth/verify` | Verify token |

### Members
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/members` | List all members |
| GET | `/api/members/:id` | Get member details |
| PUT | `/api/members/:id` | Update member |
| POST | `/api/members/:id/recharge` | Recharge balance |
| DELETE | `/api/members/:id` | Delete member |

### Sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/active` | Get active sessions |
| POST | `/api/sessions/start` | Start session |
| POST | `/api/sessions/:id/end` | End session |

### Terminals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/terminals` | List terminals |
| POST | `/api/terminals` | Add terminal |
| PUT | `/api/terminals/:id` | Update terminal |
| DELETE | `/api/terminals/:id` | Delete terminal |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookings` | List bookings |
| POST | `/api/bookings` | Create booking |
| POST | `/api/bookings/:id/cancel` | Cancel booking |

### Statistics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats/dashboard` | Dashboard stats |
| GET | `/api/stats/leaderboard` | Leaderboard |
| GET | `/api/stats/export` | Export data |

## 🎨 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: LowDB (JSON file-based)
- **Real-time**: Socket.io
- **Auth**: JWT, bcryptjs
- **Frontend**: Vanilla JS, Custom CSS
- **Fonts**: Orbitron, Rajdhani

## 🔒 Security

- Password hashing with bcrypt
- JWT-based authentication
- Input validation
- CORS enabled

## 🛠️ Development

```bash
# Run with auto-reload
npm run dev

# Initialize fresh database
npm run init-db
```

## 📝 License

MIT License - Feel free to use for your cyber cafe!

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

Made with ❤️ for gaming cafes everywhere
