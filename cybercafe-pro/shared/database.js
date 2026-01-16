/**
 * JSON Database Utility
 * Simple file-based JSON database with CRUD operations
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Read a JSON database file
 */
function readDB(collection) {
    const filePath = path.join(DATA_DIR, `${collection}.json`);
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${collection}:`, error);
        return [];
    }
}

/**
 * Write to a JSON database file
 */
function writeDB(collection, data) {
    const filePath = path.join(DATA_DIR, `${collection}.json`);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${collection}:`, error);
        return false;
    }
}

/**
 * Database operations for a collection
 */
class Collection {
    constructor(name) {
        this.name = name;
    }

    // Get all records
    findAll(filter = null) {
        const data = readDB(this.name);
        if (!filter) return data;
        return data.filter(item => {
            return Object.keys(filter).every(key => item[key] === filter[key]);
        });
    }

    // Find one record by ID
    findById(id) {
        const data = readDB(this.name);
        return data.find(item => item.id === id);
    }

    // Find one record by filter
    findOne(filter) {
        const data = readDB(this.name);
        return data.find(item => {
            return Object.keys(filter).every(key => item[key] === filter[key]);
        });
    }

    // Create a new record
    create(record) {
        const data = readDB(this.name);
        const newRecord = {
            id: uuidv4(),
            ...record,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        data.push(newRecord);
        writeDB(this.name, data);
        return newRecord;
    }

    // Update a record by ID
    update(id, updates) {
        const data = readDB(this.name);
        const index = data.findIndex(item => item.id === id);
        if (index === -1) return null;
        
        data[index] = {
            ...data[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        writeDB(this.name, data);
        return data[index];
    }

    // Delete a record by ID
    delete(id) {
        const data = readDB(this.name);
        const index = data.findIndex(item => item.id === id);
        if (index === -1) return false;
        
        data.splice(index, 1);
        writeDB(this.name, data);
        return true;
    }

    // Count records
    count(filter = null) {
        return this.findAll(filter).length;
    }

    // Aggregate operations
    aggregate(field, operation = 'sum', filter = null) {
        const data = this.findAll(filter);
        if (data.length === 0) return 0;

        const values = data.map(item => parseFloat(item[field]) || 0);
        
        switch (operation) {
            case 'sum':
                return values.reduce((a, b) => a + b, 0);
            case 'avg':
                return values.reduce((a, b) => a + b, 0) / values.length;
            case 'min':
                return Math.min(...values);
            case 'max':
                return Math.max(...values);
            case 'count':
                return values.length;
            default:
                return 0;
        }
    }
}

// Export collections
module.exports = {
    members: new Collection('members'),
    sessions: new Collection('sessions'),
    computers: new Collection('computers'),
    transactions: new Collection('transactions'),
    staff: new Collection('staff'),
    settings: new Collection('settings'),
    bookings: new Collection('bookings'),
    
    // Raw access for custom queries
    readDB,
    writeDB,
    
    // Generate UUID
    generateId: uuidv4
};
