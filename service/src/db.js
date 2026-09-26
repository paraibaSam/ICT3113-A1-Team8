const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tickets.db');

// Make sure the directory for the DB file exists (matters when DB_PATH
// points at a mounted volume like /app/data on first container start).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    narrative TEXT NOT NULL,
    category TEXT NOT NULL,
    model_used TEXT,
    classification_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const insertTicketStmt = db.prepare(`
  INSERT INTO tickets (narrative, category, model_used, classification_ms)
  VALUES (@narrative, @category, @model_used, @classification_ms)
`);

function insertTicket({ narrative, category, model_used, classification_ms }) {
  const info = insertTicketStmt.run({ narrative, category, model_used, classification_ms });
  return info.lastInsertRowid;
}

function searchTickets(query, limit = 50) {
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT id, narrative, category, created_at
       FROM tickets
       WHERE narrative LIKE ? OR category LIKE ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(like, like, limit);
}

function getStats() {
  const rows = db
    .prepare(`SELECT category, COUNT(*) AS count FROM tickets GROUP BY category`)
    .all();
  const counts = Object.fromEntries(rows.map((r) => [r.category, r.count]));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return { total, by_category: counts };
}

module.exports = { db, insertTicket, searchTickets, getStats, DB_PATH };
