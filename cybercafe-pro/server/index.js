/**
 * CyberCafe Pro - Main Server
 * Express API with WebSocket support for real-time updates
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.use('/client', express.static(path.join(__dirname, '..', 'client')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// API Routes
const membersRouter = require('./routes/members');
const sessionsRouter = require('./routes/sessions');
const computersRouter = require('./routes/computers');
const transactionsRouter = require('./routes/transactions');
const reportsRouter = require('./routes/reports');
const authRouter = require('./routes/auth');
const settingsRouter = require('./routes/settings');

app.use('/api/members', membersRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/computers', computersRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Dashboard redirect
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// WebSocket connections for real-time updates
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('New WebSocket client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleWebSocketMessage(ws, data);
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('WebSocket client disconnected');
    });

    // Send initial state
    ws.send(JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString()
    }));
});

// Broadcast updates to all connected clients
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(ws, data) {
    switch (data.type) {
        case 'pc_heartbeat':
            // PC client sending heartbeat
            broadcast({
                type: 'pc_status_update',
                pcId: data.pcId,
                status: data.status,
                timestamp: new Date().toISOString()
            });
            break;
        case 'subscribe':
            // Client subscribing to updates
            ws.subscriptions = data.channels || ['all'];
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

// Make broadcast available to routes
app.set('broadcast', broadcast);

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🎮 CyberCafe Pro Server Started                     ║
║                                                       ║
║   📡 HTTP:      http://localhost:${PORT}                 ║
║   🔌 WebSocket: ws://localhost:${PORT}                   ║
║   📊 Admin:     http://localhost:${PORT}/admin           ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
});

module.exports = { app, server, broadcast };
