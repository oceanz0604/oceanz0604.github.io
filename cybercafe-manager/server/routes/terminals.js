/**
 * Terminals Routes
 * Manage gaming PCs and consoles
 */

import { Router } from 'express';
import Database from '../db/db.js';

const router = Router();

// Get all terminals
router.get('/', (req, res) => {
  try {
    const { type, status } = req.query;
    let terminals = Database.terminals.getAll();
    
    if (type) {
      terminals = terminals.filter(t => t.type === type);
    }
    
    if (status) {
      terminals = terminals.filter(t => t.status === status);
    }
    
    res.json(terminals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available terminals
router.get('/available', (req, res) => {
  try {
    const { type } = req.query;
    let terminals = Database.terminals.getAvailable();
    
    if (type) {
      terminals = terminals.filter(t => t.type === type);
    }
    
    res.json(terminals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get terminal by ID
router.get('/:id', (req, res) => {
  try {
    const terminal = Database.terminals.getById(req.params.id);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }
    res.json(terminal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new terminal
router.post('/', async (req, res) => {
  try {
    const { name, type, ipAddress } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Terminal name required' });
    }

    // Check if name already exists
    const existing = Database.terminals.getByName(name);
    if (existing) {
      return res.status(409).json({ error: 'Terminal name already exists' });
    }

    const terminal = await Database.terminals.create({
      name,
      type: type || 'PC',
      ipAddress
    });

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.status(201).json(terminal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update terminal
router.put('/:id', async (req, res) => {
  try {
    const terminal = Database.terminals.getById(req.params.id);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    const { name, type, ipAddress, status } = req.body;
    
    // Update in database
    const updated = await Database.terminals.updateStatus(
      req.params.id,
      status || terminal.status,
      terminal.currentSessionId,
      terminal.currentMember
    );

    if (name) updated.name = name;
    if (type) updated.type = type;
    if (ipAddress) updated.ipAddress = ipAddress;
    await Database.save();

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete terminal
router.delete('/:id', async (req, res) => {
  try {
    const terminal = Database.terminals.getById(req.params.id);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    if (terminal.status === 'occupied') {
      return res.status(409).json({ error: 'Cannot delete occupied terminal' });
    }

    const success = await Database.terminals.delete(req.params.id);
    
    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.json({ success: true, message: 'Terminal deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set terminal to maintenance mode
router.post('/:id/maintenance', async (req, res) => {
  try {
    const terminal = Database.terminals.getById(req.params.id);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    if (terminal.status === 'occupied') {
      return res.status(409).json({ error: 'Cannot set occupied terminal to maintenance' });
    }

    const updated = await Database.terminals.updateStatus(
      req.params.id,
      'maintenance',
      null,
      null
    );

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set terminal back to available
router.post('/:id/activate', async (req, res) => {
  try {
    const terminal = Database.terminals.getById(req.params.id);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    if (terminal.status === 'occupied') {
      return res.status(409).json({ error: 'Terminal has active session' });
    }

    const updated = await Database.terminals.updateStatus(
      req.params.id,
      'available',
      null,
      null
    );

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('terminals:status', Database.terminals.getAll());
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get terminal statistics
router.get('/stats/summary', (req, res) => {
  try {
    const terminals = Database.terminals.getAll();
    const sessions = Database.sessions.getToday();
    
    const stats = {
      total: terminals.length,
      available: terminals.filter(t => t.status === 'available').length,
      occupied: terminals.filter(t => t.status === 'occupied').length,
      maintenance: terminals.filter(t => t.status === 'maintenance').length,
      byType: {
        PC: terminals.filter(t => t.type === 'PC').length,
        XBOX: terminals.filter(t => t.type === 'XBOX').length,
        PS: terminals.filter(t => t.type === 'PS').length
      },
      todayUsage: sessions.length
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
