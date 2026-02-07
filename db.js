const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

let sqlModulePromise;

async function getDatabase(dbPathFromEnv) {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(__dirname, "node_modules/sql.js/dist", file),
    });
  }

  const SQL = await sqlModulePromise;
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

  const close = () => {
    try {
      db.close();
    } catch (error) {
      console.error("Error closing database:", error);
    }
  };

  return { db, persist, dbPath, close };
}

function initializeSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      base_name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      currency INTEGER NOT NULL DEFAULT 0,
      grass INTEGER NOT NULL DEFAULT 0,
      last_exp_timestamp INTEGER NOT NULL DEFAULT 0,
      attack INTEGER NOT NULL DEFAULT 0,
      defense INTEGER NOT NULL DEFAULT 0,
      health INTEGER NOT NULL DEFAULT 0,
      dodge REAL NOT NULL DEFAULT 0,
      accuracy REAL NOT NULL DEFAULT 0,
      crit_rate REAL NOT NULL DEFAULT 0 CHECK (crit_rate <= 100),
      crit_resistance REAL NOT NULL DEFAULT 0,
      armor_penetration REAL NOT NULL DEFAULT 0,
      armor_resistance REAL NOT NULL DEFAULT 0,
      stamina INTEGER NOT NULL DEFAULT 10,
      last_stamina_timestamp INTEGER NOT NULL DEFAULT 0,
      chanle_played INTEGER NOT NULL DEFAULT 0,
      chanle_won INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chanle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS baucua_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_at INTEGER,
      lock_at INTEGER,
      close_at INTEGER,
      result1 TEXT,
      result2 TEXT,
      result3 TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS baucua_bets (
      round_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      face TEXT NOT NULL,
      amount INTEGER NOT NULL,
      PRIMARY KEY (round_id, user_id, face)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bicanh_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      level INTEGER NOT NULL DEFAULT 1
    );
  `);

  db.run(`
    INSERT INTO bicanh_state (id, level)
    SELECT 1, 1
    WHERE NOT EXISTS (SELECT 1 FROM bicanh_state WHERE id = 1);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS farm_sessions (
      user_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      last_tick INTEGER NOT NULL,
      total_earned INTEGER NOT NULL DEFAULT 0,
      total_grass INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shop_purchases (
      user_id TEXT NOT NULL,
      stat_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, stat_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_mounts (
      user_id TEXT NOT NULL,
      mount_id INTEGER NOT NULL,
      stats_unlocked INTEGER NOT NULL DEFAULT 0,
      base_stats TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      star INTEGER NOT NULL DEFAULT 1,
      equipped INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, mount_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS giftcodes (
      code TEXT PRIMARY KEY,
      currency INTEGER NOT NULL DEFAULT 0,
      mount_count INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER,
      uses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS giftcode_claims (
      code TEXT NOT NULL,
      user_id TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (code, user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bicanh_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      day_key TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS casino_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner_id TEXT,
      min_balance INTEGER NOT NULL DEFAULT 10000000,
      max_chanle INTEGER,
      started_at INTEGER
    );
  `);

  db.run(`
    INSERT INTO casino_state (id, min_balance)
    SELECT 1, 10000000
    WHERE NOT EXISTS (SELECT 1 FROM casino_state WHERE id = 1);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lixi_packets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      slots INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      message_id TEXT,
      channel_id TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lixi_participants (
      lixi_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      share INTEGER,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (lixi_id, user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leaderboard_messages (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      channel_id TEXT NOT NULL,
      daigia_message_id TEXT NOT NULL,
      caothu_message_id TEXT NOT NULL
    );
  `);

  const columns = db.prepare(`PRAGMA table_info(users)`);
  const existing = [];
  while (columns.step()) {
    const row = columns.getAsObject();
    existing.push(row.name);
  }
  columns.free();

  const addColumnIfMissing = (name, definition) => {
    if (existing.includes(name)) return;
    db.run(`ALTER TABLE users ADD COLUMN ${name} ${definition};`);
  };

  addColumnIfMissing("stamina", "INTEGER NOT NULL DEFAULT 10");
  addColumnIfMissing("last_stamina_timestamp", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("chanle_played", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("chanle_won", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("bicanh_level", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("grass", "INTEGER NOT NULL DEFAULT 0");

  const farmColumns = db.prepare(`PRAGMA table_info(farm_sessions)`);
  const farmExisting = [];
  while (farmColumns.step()) {
    const row = farmColumns.getAsObject();
    farmExisting.push(row.name);
  }
  farmColumns.free();

  const addFarmColumnIfMissing = (name, definition) => {
    if (farmExisting.includes(name)) return;
    db.run(`ALTER TABLE farm_sessions ADD COLUMN ${name} ${definition};`);
  };

  addFarmColumnIfMissing("total_grass", "INTEGER NOT NULL DEFAULT 0");
}

module.exports = { getDatabase };
