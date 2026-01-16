/**
 * Members API Routes
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../../shared/database');
const { MEMBER_TYPE, TRANSACTION_TYPE, PAYMENT_METHOD } = require('../../shared/constants');

// Get all members
router.get('/', (req, res) => {
    try {
        const members = db.members.findAll();
        // Don't send passwords
        const safeMembers = members.map(m => {
            const { password, ...member } = m;
            return member;
        });
        res.json(safeMembers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get member by ID
router.get('/:id', (req, res) => {
    try {
        const member = db.members.findById(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        const { password, ...safeMember } = member;
        res.json(safeMember);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Search members
router.get('/search/:query', (req, res) => {
    try {
        const query = req.params.query.toLowerCase();
        const members = db.members.findAll();
        const results = members.filter(m => 
            m.username.toLowerCase().includes(query) ||
            m.name.toLowerCase().includes(query) ||
            (m.phone && m.phone.includes(query)) ||
            (m.email && m.email.toLowerCase().includes(query))
        ).map(m => {
            const { password, ...member } = m;
            return member;
        });
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new member
router.post('/', async (req, res) => {
    try {
        const { username, name, phone, email, password, type = MEMBER_TYPE.REGULAR } = req.body;

        // Validate required fields
        if (!username || !name) {
            return res.status(400).json({ error: 'Username and name are required' });
        }

        // Check if username exists
        const existing = db.members.findOne({ username: username.toLowerCase() });
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password if provided
        const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

        const member = db.members.create({
            username: username.toLowerCase(),
            displayName: username, // Keep original case for display
            name,
            phone: phone || null,
            email: email || null,
            password: hashedPassword,
            type,
            balance: 0,
            totalMinutes: 0,
            totalSpent: 0,
            sessionsCount: 0,
            isActive: true,
            lastVisit: null
        });

        const { password: pwd, ...safeMember } = member;
        
        // Broadcast update
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
            broadcast({ type: 'member_created', member: safeMember });
        }

        res.status(201).json(safeMember);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update member
router.put('/:id', async (req, res) => {
    try {
        const { name, phone, email, type, isActive, password } = req.body;
        
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (email !== undefined) updates.email = email;
        if (type !== undefined) updates.type = type;
        if (isActive !== undefined) updates.isActive = isActive;
        if (password) {
            updates.password = await bcrypt.hash(password, 10);
        }

        const member = db.members.update(req.params.id, updates);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const { password: pwd, ...safeMember } = member;
        res.json(safeMember);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Recharge member balance
router.post('/:id/recharge', (req, res) => {
    try {
        const { amount, paymentMethod = PAYMENT_METHOD.CASH, note } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount is required' });
        }

        const member = db.members.findById(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Update balance
        const newBalance = (member.balance || 0) + parseFloat(amount);
        const updatedMember = db.members.update(req.params.id, { 
            balance: newBalance,
            totalSpent: (member.totalSpent || 0) + parseFloat(amount)
        });

        // Create transaction record
        const transaction = db.transactions.create({
            memberId: req.params.id,
            memberName: member.name,
            type: TRANSACTION_TYPE.RECHARGE,
            amount: parseFloat(amount),
            paymentMethod,
            balanceAfter: newBalance,
            note: note || null
        });

        // Broadcast update
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
            broadcast({ 
                type: 'member_recharged', 
                memberId: req.params.id,
                amount,
                newBalance 
            });
        }

        res.json({
            member: { ...updatedMember, password: undefined },
            transaction
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get member statistics
router.get('/:id/stats', (req, res) => {
    try {
        const member = db.members.findById(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const sessions = db.sessions.findAll({ memberId: req.params.id });
        const transactions = db.transactions.findAll({ memberId: req.params.id });

        // Calculate stats
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
        const totalSpent = transactions
            .filter(t => t.type === TRANSACTION_TYPE.RECHARGE)
            .reduce((sum, t) => sum + t.amount, 0);

        res.json({
            totalMinutes,
            totalSpent,
            sessionsCount: sessions.length,
            transactionsCount: transactions.length,
            lastSessions: sessions.slice(-10).reverse(),
            lastTransactions: transactions.slice(-10).reverse()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete member (soft delete)
router.delete('/:id', (req, res) => {
    try {
        const member = db.members.update(req.params.id, { 
            isActive: false,
            deletedAt: new Date().toISOString()
        });
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.json({ message: 'Member deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
