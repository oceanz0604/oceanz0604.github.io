/**
 * Computers API Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../../shared/database');
const { PC_STATUS, PC_CATEGORIES, SESSION_STATUS } = require('../../shared/constants');

// Get all computers
router.get('/', (req, res) => {
    try {
        let computers = db.computers.findAll();
        
        // Apply filters
        if (req.query.status) {
            computers = computers.filter(c => c.status === req.query.status);
        }
        if (req.query.category) {
            computers = computers.filter(c => c.category === req.query.category);
        }

        // Sort by name
        computers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        
        res.json(computers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get computer by ID
router.get('/:id', (req, res) => {
    try {
        const computer = db.computers.findById(req.params.id);
        if (!computer) {
            return res.status(404).json({ error: 'Computer not found' });
        }
        
        // Get current session if any
        if (computer.currentSessionId) {
            computer.currentSession = db.sessions.findById(computer.currentSessionId);
        }
        
        res.json(computer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new computer
router.post('/', (req, res) => {
    try {
        const { name, ipAddress, macAddress, category = PC_CATEGORIES.STANDARD, specs } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Computer name is required' });
        }

        // Check if name exists
        const existing = db.computers.findOne({ name });
        if (existing) {
            return res.status(400).json({ error: 'Computer name already exists' });
        }

        const computer = db.computers.create({
            name,
            ipAddress: ipAddress || null,
            macAddress: macAddress || null,
            category,
            specs: specs || {},
            status: PC_STATUS.AVAILABLE,
            currentSessionId: null,
            currentUser: null,
            lastHeartbeat: null,
            totalSessions: 0,
            totalMinutes: 0,
            isActive: true
        });

        // Broadcast update
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
            broadcast({ type: 'computer_added', computer });
        }

        res.status(201).json(computer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update computer
router.put('/:id', (req, res) => {
    try {
        const { name, ipAddress, macAddress, category, specs, isActive } = req.body;
        
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (ipAddress !== undefined) updates.ipAddress = ipAddress;
        if (macAddress !== undefined) updates.macAddress = macAddress;
        if (category !== undefined) updates.category = category;
        if (specs !== undefined) updates.specs = specs;
        if (isActive !== undefined) updates.isActive = isActive;

        const computer = db.computers.update(req.params.id, updates);
        if (!computer) {
            return res.status(404).json({ error: 'Computer not found' });
        }

        res.json(computer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update computer status
router.put('/:id/status', (req, res) => {
    try {
        const { status } = req.body;
        
        if (!Object.values(PC_STATUS).includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // If setting to available, clear current session
        const updates = { status };
        if (status === PC_STATUS.AVAILABLE) {
            updates.currentSessionId = null;
            updates.currentUser = null;
        }

        const computer = db.computers.update(req.params.id, updates);
        if (!computer) {
            return res.status(404).json({ error: 'Computer not found' });
        }

        // Broadcast update
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
            broadcast({ type: 'computer_status_changed', computer });
        }

        res.json(computer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Heartbeat from PC client
router.post('/:id/heartbeat', (req, res) => {
    try {
        const { ipAddress, status, metrics } = req.body;
        
        const updates = {
            lastHeartbeat: new Date().toISOString(),
            ipAddress: ipAddress || undefined
        };

        if (metrics) {
            updates.metrics = metrics; // CPU, RAM, etc.
        }

        const computer = db.computers.update(req.params.id, updates);
        if (!computer) {
            return res.status(404).json({ error: 'Computer not found' });
        }

        // Check if there's an active session
        const session = computer.currentSessionId 
            ? db.sessions.findById(computer.currentSessionId)
            : null;

        res.json({
            computer,
            session,
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get available computers
router.get('/available/list', (req, res) => {
    try {
        const computers = db.computers.findAll({ status: PC_STATUS.AVAILABLE })
            .filter(c => c.isActive !== false);
        res.json(computers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get computers summary
router.get('/status/summary', (req, res) => {
    try {
        const computers = db.computers.findAll();
        
        const summary = {
            total: computers.length,
            available: computers.filter(c => c.status === PC_STATUS.AVAILABLE).length,
            inUse: computers.filter(c => c.status === PC_STATUS.IN_USE).length,
            reserved: computers.filter(c => c.status === PC_STATUS.RESERVED).length,
            maintenance: computers.filter(c => c.status === PC_STATUS.MAINTENANCE).length,
            offline: computers.filter(c => c.status === PC_STATUS.OFFLINE).length,
            byCategory: {}
        };

        // Count by category
        computers.forEach(c => {
            const cat = c.category || 'standard';
            if (!summary.byCategory[cat]) {
                summary.byCategory[cat] = { total: 0, available: 0, inUse: 0 };
            }
            summary.byCategory[cat].total++;
            if (c.status === PC_STATUS.AVAILABLE) summary.byCategory[cat].available++;
            if (c.status === PC_STATUS.IN_USE) summary.byCategory[cat].inUse++;
        });

        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete computer (soft delete)
router.delete('/:id', (req, res) => {
    try {
        // Check for active sessions
        const computer = db.computers.findById(req.params.id);
        if (computer?.currentSessionId) {
            return res.status(400).json({ error: 'Cannot delete computer with active session' });
        }

        const updated = db.computers.update(req.params.id, { 
            isActive: false,
            status: PC_STATUS.OFFLINE,
            deletedAt: new Date().toISOString()
        });
        
        if (!updated) {
            return res.status(404).json({ error: 'Computer not found' });
        }

        res.json({ message: 'Computer deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
