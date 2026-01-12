const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

let databasePromise;

async function getDatabase(dbPathFromEnv) {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(__dirname, "node_modules/sql.js/dist", file),
    });

    const dbPath = dbPathFromEnv || "./data.db";
    const hasDbFile = fs.existsSync(dbPath);
    const fileBuffer = hasDbFile ? fs.readFileSync(dbPath) : null;
    const db = new SQL.Database(fileBuffer);

    initializeSchema(db);

    const persist = () => {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    };

    if (!hasDbFile) {
      persist();
    }

    return { db, persist, dbPath };
  })();

  return databasePromise;
}

function initializeSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      base_name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      currency INTEGER NOT NULL DEFAULT 0,
      last_exp_timestamp INTEGER NOT NULL DEFAULT 0,
      attack INTEGER NOT NULL DEFAULT 0,
      defense INTEGER NOT NULL DEFAULT 0,
      health INTEGER NOT NULL DEFAULT 0,
      dodge REAL NOT NULL DEFAULT 0,
      accuracy REAL NOT NULL DEFAULT 0,
      crit_rate REAL NOT NULL DEFAULT 0 CHECK (crit_rate <= 100),
      crit_resistance REAL NOT NULL DEFAULT 0,
      armor_penetration REAL NOT NULL DEFAULT 0,
      armor_resistance REAL NOT NULL DEFAULT 0
    );
  `);
}

module.exports = { getDatabase };
