/**
 * Application Constants
 */

module.exports = {
    // Session status
    SESSION_STATUS: {
        ACTIVE: 'active',
        ENDED: 'ended',
        PAUSED: 'paused'
    },

    // Computer status
    PC_STATUS: {
        AVAILABLE: 'available',
        IN_USE: 'in_use',
        RESERVED: 'reserved',
        MAINTENANCE: 'maintenance',
        OFFLINE: 'offline'
    },

    // Member types
    MEMBER_TYPE: {
        REGULAR: 'regular',
        VIP: 'vip',
        STUDENT: 'student',
        GUEST: 'guest'
    },

    // Transaction types
    TRANSACTION_TYPE: {
        RECHARGE: 'recharge',
        SESSION_CHARGE: 'session_charge',
        PACKAGE_PURCHASE: 'package_purchase',
        REFUND: 'refund',
        ADJUSTMENT: 'adjustment'
    },

    // Payment methods
    PAYMENT_METHOD: {
        CASH: 'cash',
        UPI: 'upi',
        CARD: 'card',
        BALANCE: 'balance'
    },

    // Staff roles
    STAFF_ROLE: {
        ADMIN: 'admin',
        MANAGER: 'manager',
        OPERATOR: 'operator'
    },

    // Default rates (per hour in INR)
    DEFAULT_RATES: {
        PC: {
            regular: 40,
            vip: 35,
            student: 30,
            guest: 50
        },
        XBOX: {
            regular: 60,
            vip: 55,
            student: 50,
            guest: 70
        },
        PS: {
            regular: 100,
            vip: 90,
            student: 80,
            guest: 120
        }
    },

    // Packages
    DEFAULT_PACKAGES: [
        { id: 'pkg_1hr', name: '1 Hour', minutes: 60, price: 40, bonus: 0 },
        { id: 'pkg_2hr', name: '2 Hours', minutes: 120, price: 75, bonus: 5 },
        { id: 'pkg_5hr', name: '5 Hours', minutes: 300, price: 175, bonus: 25 },
        { id: 'pkg_10hr', name: '10 Hours', minutes: 600, price: 320, bonus: 80 },
        { id: 'pkg_night', name: 'Night Pass (10PM-8AM)', minutes: 600, price: 200, bonus: 0 }
    ],

    // Business hours
    BUSINESS_HOURS: {
        open: '10:00',
        close: '23:00',
        nightStart: '22:00',
        nightEnd: '08:00'
    },

    // Computer categories
    PC_CATEGORIES: {
        GAMING: 'gaming',
        STANDARD: 'standard',
        CONSOLE: 'console'
    }
};
