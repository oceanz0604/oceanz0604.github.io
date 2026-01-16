/**
 * Sessions Routes
 * Handle gaming sessions
 */

import { Router } from 'express';
import Database from '../db/db.js';

const router = Router();

// Get all sessions
router.get('/', (req, res) => {
  try {
    const { status, date, memberId } = req.query;
    let sessions = Database.sessions.getAll();
    
    if (status) {
      sessions = sessions.filter(s => s.status === status);
    }
    
    if (date) {
      sessions = sessions.filter(s => s.startTime.startsWith(date));
    }
    
    if (memberId) {
      sessions = sessions.filter(s => s.memberId === memberId);
    }
    
    // Sort by start time descending
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active sessions
router.get('/active', (req, res) => {
  try {
    const sessions = Database.sessions.getActive();
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's sessions
router.get('/today', (req, res) => {
  try {
    const sessions = Database.sessions.getToday();
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session by ID
router.get('/:id', (req, res) => {
  try {
    const session = Database.sessions.getAll().find(s => s.id === req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a new session
router.post('/start', async (req, res) => {
  try {
    const { memberId, memberUsername, terminalId, terminalName, deviceType } = req.body;
    
    if (!terminalId) {
      return res.status(400).json({ error: 'Terminal ID required' });
    }

    // Check if terminal is available
    const terminal = Database.terminals.getById(terminalId);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }
    
    if (terminal.status !== 'available') {
      return res.status(409).json({ error: 'Terminal is not available' });
    }

    // Get rate based on device type
    const rates = Database.settings.getRates();
    const rate = rates[deviceType || terminal.type] || rates.PC;

    // If member, check balance
    if (memberId) {
      const member = Database.members.getById(memberId);
      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }
      if (member.balance < rate) {
        return res.status(400).json({ 
          error: 'Insufficient balance',
          balance: member.balance,
          requiredPerHour: rate
        });
      }
    }

    // Start session
    const session = await Database.sessions.start({
      memberId,
      memberUsername: memberUsername || 'Guest',
      terminalId,
      terminalName: terminalName || terminal.name,
      deviceType: deviceType || terminal.type,
      rate
    });

    // Update terminal status
    await Database.terminals.updateStatus(
      terminalId,
      'occupied',
      session.id,
      memberId ? { id: memberId, username: memberUsername } : null
    );

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('session:started', session);
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// End a session
router.post('/:id/end', async (req, res) => {
  try {
    const session = await Database.sessions.end(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Update terminal status
    await Database.terminals.updateStatus(session.terminalId, 'available', null, null);

    // Create transaction record for member sessions
    if (session.memberId && session.cost > 0) {
      await Database.transactions.create({
        memberId: session.memberId,
        memberUsername: session.memberUsername,
        type: 'session',
        amount: -session.cost,
        description: `Session on ${session.terminalName}: ${session.duration} minutes`,
        paymentMethod: 'balance'
      });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('session:ended', session);
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session statistics
router.get('/stats/summary', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let sessions = Database.sessions.getAll();
    
    if (startDate) {
      sessions = sessions.filter(s => s.startTime >= startDate);
    }
    if (endDate) {
      sessions = sessions.filter(s => s.startTime <= endDate);
    }

    const completed = sessions.filter(s => s.status === 'completed');
    
    const stats = {
      totalSessions: completed.length,
      totalMinutes: completed.reduce((sum, s) => sum + s.duration, 0),
      totalRevenue: completed.reduce((sum, s) => sum + s.cost, 0),
      guestSessions: completed.filter(s => s.isGuest).length,
      memberSessions: completed.filter(s => !s.isGuest).length,
      byDeviceType: {
        PC: completed.filter(s => s.deviceType === 'PC').length,
        XBOX: completed.filter(s => s.deviceType === 'XBOX').length,
        PS: completed.filter(s => s.deviceType === 'PS').length
      }
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
