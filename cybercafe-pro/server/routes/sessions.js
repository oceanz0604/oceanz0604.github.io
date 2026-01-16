/**
 * Sessions API Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../../shared/database');
const { SESSION_STATUS, PC_STATUS, TRANSACTION_TYPE, DEFAULT_RATES } = require('../../shared/constants');

// Get all sessions (with optional filters)
router.get('/', (req, res) => {
    try {
        let sessions = db.sessions.findAll();
        
        // Apply filters
        if (req.query.status) {
            sessions = sessions.filter(s => s.status === req.query.status);
        }
        if (req.query.date) {
            const date = req.query.date;
            sessions = sessions.filter(s => s.startTime.startsWith(date));
        }
        if (req.query.memberId) {
            sessions = sessions.filter(s => s.memberId === req.query.memberId);
        }
        if (req.query.pcId) {
            sessions = sessions.filter(s => s.pcId === req.query.pcId);
        }

        res.json(sessions.reverse()); // Most recent first
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get active sessions
router.get('/active', (req, res) => {
    try {
        const sessions = db.sessions.findAll({ status: SESSION_STATUS.ACTIVE });
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get session by ID
router.get('/:id', (req, res) => {
    try {
        const session = db.sessions.findById(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start a new session
router.post('/start', (req, res) => {
    try {
        const { memberId, pcId, isGuest = false, guestName } = req.body;

        // Validate
        if (!pcId) {
            return res.status(400).json({ error: 'PC ID is required' });
        }

        // Check if PC is available
        const computer = db.computers.findById(pcId);
        if (!computer) {
            return res.status(404).json({ error: 'Computer not found' });
        }
        if (computer.status !== PC_STATUS.AVAILABLE) {
            return res.status(400).json({ error: 'Computer is not available' });
        }

        // Get member info (if not guest)
        let member = null;
        if (!isGuest && memberId) {
            member = db.members.findById(memberId);
            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }
            // Check if member has active session
            const activeSession = db.sessions.findOne({ 
                memberId, 
                status: SESSION_STATUS.ACTIVE 
            });
            if (activeSession) {
                return res.status(400).json({ 
                    error: 'Member already has an active session',
                    sessionId: activeSession.id 
                });
            }
        }

        // Determine rate based on member type and PC category
        const memberType = member?.type || 'guest';
        const pcCategory = computer.category || 'PC';
        const rateCategory = DEFAULT_RATES[pcCategory.toUpperCase()] || DEFAULT_RATES.PC;
        const rate = rateCategory[memberType] || rateCategory.guest;

        // Create session
        const session = db.sessions.create({
            memberId: memberId || null,
            memberName: member?.name || guestName || 'Guest',
            memberUsername: member?.displayName || member?.username || null,
            pcId,
            pcName: computer.name,
            pcCategory: computer.category,
            isGuest,
            startTime: new Date().toISOString(),
            endTime: null,
            duration: 0,
            rate,
            cost: 0,
            status: SESSION_STATUS.ACTIVE
        });

        // Update PC status
        db.computers.update(pcId, {
            status: PC_STATUS.IN_USE,
            currentSessionId: session.id,
            currentUser: session.memberName
        });

        // Update member last visit
        if (member) {
            db.members.update(memberId, { lastVisit: new Date().toISOString() });
        }

        // Broadcast update
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
            broadcast({ 
                type: 'session_started', 
                session,
                pcId,
                pcStatus: PC_STATUS.IN_USE
            });
        }

        res.status(201).json(session);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// End a session
router.post('/end', (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const session = db.sessions.findById(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (session.status !== SESSION_STATUS.ACTIVE) {
            return res.status(400).json({ error: 'Session is not active' });
        }

        // Calculate duration and cost
        const startTime = new Date(session.startTime);
        const endTime = new Date();
        const durationMinutes = Math.ceil((endTime - startTime) / (1000 * 60));
        const cost = Math.round((durationMinutes / 60) * session.rate * 100) / 100;

        // Update session
        const updatedSession = db.sessions.update(sessionId, {
            endTime: endTime.toISOString(),
            duration: durationMinutes,
            cost,
            status: SESSION_STATUS.ENDED
        });

        // Update PC status
        db.computers.update(session.pcId, {
            status: PC_STATUS.AVAILABLE,
            currentSessionId: null,
            currentUser: null
        });

        // Update member stats
        if (session.memberId) {
            const member = db.members.findById(session.memberId);
            if (member) {
                const newBalance = (member.balance || 0) - cost;
                db.members.update(session.memberId, {
                    balance: newBalance,
                    totalMinutes: (member.totalMinutes || 0) + durationMinutes,
                    sessionsCount: (member.sessionsCount || 0) + 1
                });

                // Create transaction for session charge
                db.transactions.create({
                    memberId: session.memberId,
                    memberName: session.memberName,
                    type: TRANSACTION_TYPE.SESSION_CHARGE,
                    amount: -cost,
                    balanceAfter: newBalance,
                    sessionId,
                    note: `Session on ${session.pcName} - ${durationMinutes} minutes`
                });
            }
        }

        // Broadcast update
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
            broadcast({ 
                type: 'session_ended', 
                session: updatedSession,
                pcId: session.pcId,
                pcStatus: PC_STATUS.AVAILABLE
            });
        }

        res.json(updatedSession);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// End session by PC ID
router.post('/end-by-pc/:pcId', (req, res) => {
    try {
        const session = db.sessions.findOne({ 
            pcId: req.params.pcId, 
            status: SESSION_STATUS.ACTIVE 
        });

        if (!session) {
            return res.status(404).json({ error: 'No active session on this PC' });
        }

        // Redirect to end session
        req.body.sessionId = session.id;
        router.handle(Object.assign({}, req, { 
            method: 'POST', 
            url: '/end',
            body: { sessionId: session.id }
        }), res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get today's sessions
router.get('/today/summary', (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sessions = db.sessions.findAll()
            .filter(s => s.startTime.startsWith(today));

        const activeSessions = sessions.filter(s => s.status === SESSION_STATUS.ACTIVE);
        const completedSessions = sessions.filter(s => s.status === SESSION_STATUS.ENDED);

        const totalRevenue = completedSessions.reduce((sum, s) => sum + (s.cost || 0), 0);
        const totalMinutes = completedSessions.reduce((sum, s) => sum + (s.duration || 0), 0);

        res.json({
            date: today,
            totalSessions: sessions.length,
            activeSessions: activeSessions.length,
            completedSessions: completedSessions.length,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalMinutes,
            sessions: sessions.reverse()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
