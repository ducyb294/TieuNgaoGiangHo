const fs = require("fs");
const path = require("path");

const ITEMS_PATH = path.join(__dirname, "..", "data", "items");
const DAILY_LIMIT = 5;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const REWARDS = [
  { type: "currency", base: 50000000, chance: 50 },
  { type: "currency", base: 100000000, chance: 20 },
  { type: "grass", base: 1000, chance: 15 },
  { type: "mount", base: 1, chance: 10 },
  { type: "grass", base: 5000, chance: 3 },
  { type: "grass", base: 50000, chance: 1 },
  { type: "currency", base: 500000000, chance: 1 },
];

function loadMountDefinitions() {
  if (!fs.existsSync(ITEMS_PATH)) return [];
  const content = fs.readFileSync(ITEMS_PATH, "utf8");
  const lines = content.split(/\r?\n/);
  const list = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/[\t|,]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const id = Number(parts[0]);
    if (!Number.isFinite(id)) continue;
    const name = parts.slice(1).join(" ").trim();
    if (!name) continue;
    list.push({ id, name });
  }
  return list;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getVietnamDayKey(timestamp) {
  const d = new Date(timestamp + VN_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function randomizeAmount(base) {
  const factor = 0.8 + Math.random() * 0.4;
  return Math.max(0, Math.floor(base * factor));
}

function rollReward() {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const reward of REWARDS) {
    acc += reward.chance;
    if (roll < acc) {
      return reward;
    }
  }
  return REWARDS[0];
}

function createGachaService({
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  GACHA_CHANNEL_ID,
}) {
  const getOwnedMountIds = (db, userId) => {
    const stmt = db.prepare(
      "SELECT mount_id FROM user_mounts WHERE user_id = ?"
    );
    stmt.bind([userId]);
    const ids = new Set();
    while (stmt.step()) {
      const row = stmt.getAsObject();
      ids.add(Number(row.mount_id));
    }
    stmt.free();
    return ids;
  };

  const grantRandomMount = (db, userId) => {
    const available = loadMountDefinitions();
    if (!available.length) return null;

    const owned = getOwnedMountIds(db, userId);
    const candidates = available.filter((m) => !owned.has(m.id));
    if (!candidates.length) return null;

    shuffle(candidates);
    const pick = candidates[0];
    const now = Date.now();
    db.run(
      `INSERT OR IGNORE INTO user_mounts
       (user_id, mount_id, stats_unlocked, base_stats, level, exp, star, equipped, created_at)
       VALUES (?, ?, 0, NULL, 1, 0, 1, 0, ?)`,
      [userId, pick.id, now]
    );
    return pick;
  };

  async function handleGacha(interaction, db, persist) {
    if (GACHA_CHANNEL_ID && interaction.channelId !== GACHA_CHANNEL_ID) {
      await interaction.reply({
        embeds: [
          {
            color: 0xe74c3c,
            title: "Không đúng kênh",
            description: TEXT.gachaChannelOnly,
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);

    const now = Date.now();
    const todayKey = getVietnamDayKey(now);
    const storedKey = user.gacha_day_key || "";
    let currentCount = Number(user.gacha_count || 0);

    if (storedKey !== todayKey) {
      currentCount = 0;
    }

    if (currentCount >= DAILY_LIMIT) {
      await interaction.reply({
        embeds: [
          {
            color: 0xf1c40f,
            title: "Hết lượt gacha hôm nay",
            description: "Bạn đã dùng hết 5 lượt gacha hôm nay. Reset lúc 00:00 (GMT+7).",
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const reward = rollReward();
    let currencyReward = 0;
    let grassReward = 0;
    let mountReward = null;
    let note = "";

    if (reward.type === "currency") {
      currencyReward = randomizeAmount(reward.base);
    } else if (reward.type === "grass") {
      grassReward = randomizeAmount(reward.base);
    } else if (reward.type === "mount") {
      mountReward = grantRandomMount(db, user.user_id);
      if (!mountReward) {
        currencyReward = randomizeAmount(50000000);
        note = "Bạn đã sở hữu hết thú cưỡi, đổi thành Ngân Lượng.";
      }
    }

    db.run("BEGIN");
    if (storedKey !== todayKey) {
      db.run(
        "UPDATE users SET gacha_day_key = ?, gacha_count = 0 WHERE user_id = ?",
        [todayKey, user.user_id]
      );
    }
    if (currencyReward > 0) {
      db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [
        currencyReward,
        user.user_id,
      ]);
    }
    if (grassReward > 0) {
      db.run("UPDATE users SET grass = grass + ? WHERE user_id = ?", [
        grassReward,
        user.user_id,
      ]);
    }
    db.run("UPDATE users SET gacha_count = gacha_count + 1 WHERE user_id = ?", [
      user.user_id,
    ]);
    db.run("COMMIT");
    persist();

    const newCount = currentCount + 1;
    const remaining = Math.max(0, DAILY_LIMIT - newCount);
    const rewardLines = [];

    if (currencyReward > 0) {
      rewardLines.push(`Ngân lượng: **${formatNumber(currencyReward)} ${CURRENCY_NAME}**`);
    }
    if (grassReward > 0) {
      rewardLines.push(`Cỏ: **${formatNumber(grassReward)}**`);
    }
    if (mountReward) {
      rewardLines.push(`Thú cưỡi: **${mountReward.name}** (ID ${mountReward.id})`);
    }
    if (note) {
      rewardLines.push(`_${note}_`);
    }

    await interaction.reply({
      embeds: [
        {
          color: 0x2ecc71,
          title: "🎁 Gacha năm mới",
          description: rewardLines.join("\n"),
          footer: { text: `Lượt còn lại hôm nay: ${remaining}/${DAILY_LIMIT}` },
          timestamp: new Date(),
        },
      ],
      ephemeral: false,
    });
  }

  async function handleTile(interaction) {
    const lines = [
      "50% - 50,000,000 Ngân Lượng (random 80% - 120%)",
      "20% - 100,000,000 Ngân Lượng (random 80% - 120%)",
      "15% - 1,000 Cỏ (random 80% - 120%)",
      "10% - 1 Thú cưỡi",
      "3% - 5,000 Cỏ (random 80% - 120%)",
      "1% - 50,000 Cỏ (random 80% - 120%)",
      "1% - 500,000,000 Ngân Lượng (random 80% - 120%)",
    ];

    await interaction.reply({
      embeds: [
        {
          color: 0x3498db,
          title: "Bảng tỉ lệ",
          description: lines.map((line) => `• ${line}`).join("\n"),
          footer: { text: "/tile" },
          timestamp: new Date(),
        },
      ],
      ephemeral: false,
    });
  }

  return { handleGacha, handleTile };
}

module.exports = createGachaService;