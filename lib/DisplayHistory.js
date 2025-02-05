const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const Logger = require("./Logger");

// Default and environment-based paths
const DEFAULT_DB_PATH = path.join(__dirname, 'display-history.db');
const STORAGE_PATH = process.env.STORAGE_PATH ?
    path.join(process.env.STORAGE_PATH, 'display-history.db') :
    DEFAULT_DB_PATH;


class DisplayHistory {
    constructor(dbPath = STORAGE_PATH) {
        this.db = new sqlite3.Database(dbPath);
        this.initialize();
    }

    initialize() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS image_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                display_buffer BLOB NOT NULL,
                timestamp INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                display_type TEXT NOT NULL
            )
        `, (err) => {
            if (err) {
                Logger.log('DisplayHistory', 'error', `Failed to initialize database: ${err}`);
            } else {
                Logger.log('DisplayHistory', 'info', 'Database initialized');
            }
        });
    }

    async getTotalCount(deviceId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT COUNT(*) as total FROM image_history WHERE device_id = ?',
                [deviceId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row.total);
                    }
                }
            );
        });
    }

    async addEntry(deviceId, displayBuffer, width, height, displayType) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO image_history 
                (device_id, display_buffer, timestamp, width, height, display_type)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            stmt.run(
                deviceId,
                displayBuffer,
                Date.now(),
                width,
                height,
                displayType,
                function(err) {
                    stmt.finalize();
                    if (err) {
                        Logger.log('DisplayHistory', 'error', `Failed to add history entry: ${err}`);
                        reject(err);
                    } else {
                        Logger.log('DisplayHistory', 'info', `Added history entry ${this.lastID} for device ${deviceId}`);
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    async getHistory(deviceId, limit = 10, offset = 0) {
        const [rows, total] = await Promise.all([
            new Promise((resolve, reject) => {
                this.db.all(`
                SELECT id, device_id, timestamp, width, height, display_type 
                FROM image_history 
                WHERE device_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ? OFFSET ?
            `, [deviceId, limit, offset], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            }),
            this.getTotalCount(deviceId)
        ]);

        return {
            entries: rows,
            metadata: {
                total,
                offset,
                limit,
                hasMore: offset + rows.length < total
            }
        };
    }

    async getEntry(id) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM image_history WHERE id = ?
            `, [id], (err, row) => {
                if (err) {
                    Logger.log('DisplayHistory', 'error', `Failed to get entry ${id}: ${err}`);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async deleteEntry(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM image_history WHERE id = ?', [id], function(err) {
                if (err) {
                    Logger.log('DisplayHistory', 'error', `Failed to delete entry ${id}: ${err}`);
                    reject(err);
                } else {
                    Logger.log('DisplayHistory', 'info', `Deleted history entry ${id}`);
                    resolve();
                }
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    Logger.log('DisplayHistory', 'error', `Failed to close database: ${err}`);
                    reject(err);
                } else {
                    Logger.log('DisplayHistory', 'info', 'Database closed');
                    resolve();
                }
            });
        });
    }
}

module.exports = DisplayHistory;