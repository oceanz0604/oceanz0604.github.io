/**
 * CyberCafe Manager - Main Server
 * A modern cyber cafe management system with JSON database
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import routes
import authRoutes from './routes/auth.js';
import membersRoutes from './routes/members.js';
import sessionsRoutes from './routes/sessions.js';
import terminalsRoutes from './routes/terminals.js';
import bookingsRoutes from './routes/bookings.js';
import statsRoutes from './routes/stats.js';

// Import database
import Database from './db/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Initialize Express
const app = express();
const httpServer = createServer(app);

// Initialize Socket.io for real-time updates
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Make io available to routes
app.set('io', io);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/terminals', terminalsRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/stats', statsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Settings endpoint
app.get('/api/settings', (req, res) => {
  res.json(Database.settings.get());
});

app.put('/api/settings', async (req, res) => {
  try {
    const settings = await Database.settings.update(req.body);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send current terminal status on connect
  socket.emit('terminals:status', Database.terminals.getAll());

  // Handle terminal client registration
  socket.on('terminal:register', async (data) => {
    console.log(`🖥️  Terminal registered: ${data.name}`);
    let terminal = Database.terminals.getByName(data.name);
    
    if (!terminal) {
      terminal = await Database.terminals.create({
        name: data.name,
        type: data.type || 'PC',
        ipAddress: data.ipAddress
      });
    }
    
    socket.terminalId = terminal.id;
    socket.emit('terminal:registered', terminal);
    io.emit('terminals:status', Database.terminals.getAll());
  });

  // Handle session start from terminal
  socket.on('session:start', async (data) => {
    try {
      const session = await Database.sessions.start(data);
      await Database.terminals.updateStatus(
        data.terminalId, 
        'occupied', 
        session.id,
        { username: data.memberUsername, id: data.memberId }
      );
      
      io.emit('session:started', session);
      io.emit('terminals:status', Database.terminals.getAll());
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Handle session end
  socket.on('session:end', async (data) => {
    try {
      const session = await Database.sessions.end(data.sessionId);
      if (session) {
        await Database.terminals.updateStatus(session.terminalId, 'available', null, null);
        io.emit('session:ended', session);
        io.emit('terminals:status', Database.terminals.getAll());
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Serve frontend routes
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, '../public/admin/index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(join(__dirname, '../public/admin/index.html'));
});

app.get('/member', (req, res) => {
  res.sendFile(join(__dirname, '../public/member/index.html'));
});

app.get('/member/*', (req, res) => {
  res.sendFile(join(__dirname, '../public/member/index.html'));
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎮  CyberCafe Manager v1.0.0                           ║
║                                                           ║
║   Server running on http://localhost:${PORT}               ║
║                                                           ║
║   📊 Admin Dashboard:  http://localhost:${PORT}/admin      ║
║   👤 Member Portal:    http://localhost:${PORT}/member     ║
║   📡 API Endpoint:     http://localhost:${PORT}/api        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { io };
