const fs = require("fs");
const path = require("path");

const ITEMS_PATH = path.join(__dirname, "..", "data", "items");

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

function createGiftCodeService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  GIFT_CODE_CHANNEL_ID,
}) {
  const ensureGiftCode = (db, persist) => {
    const now = Date.now();
    db.run(
      `INSERT INTO giftcodes (code, currency, mount_count, max_uses, uses, active, created_at)
       VALUES (?, ?, ?, NULL, 0, 1, ?)
       ON CONFLICT(code) DO UPDATE SET
         currency = excluded.currency,
         mount_count = excluded.mount_count,
         active = excluded.active`,
      ["truongquaylevel100", 50000000, 5, now]
    );
    persist();
  };

  const getGiftCode = (db, code) => {
    const stmt = db.prepare(
      `SELECT code, currency, mount_count, max_uses, uses, active
       FROM giftcodes WHERE code = ?`
    );
    stmt.bind([code]);
    const hasRow = stmt.step();
    const row = hasRow ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  };

  const hasClaimed = (db, code, userId) => {
    const stmt = db.prepare(
      "SELECT 1 FROM giftcode_claims WHERE code = ? AND user_id = ?"
    );
    stmt.bind([code, userId]);
    const claimed = stmt.step();
    stmt.free();
    return claimed;
  };

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

  const grantMounts = (db, userId, count) => {
    const available = loadMountDefinitions();
    if (!available.length || count <= 0) return [];

    const owned = getOwnedMountIds(db, userId);
    const candidates = available.filter((m) => !owned.has(m.id));
    if (!candidates.length) return [];

    shuffle(candidates);
    const picks = candidates.slice(0, Math.min(count, candidates.length));
    const now = Date.now();
    for (const mount of picks) {
      db.run(
        `INSERT OR IGNORE INTO user_mounts
         (user_id, mount_id, stats_unlocked, base_stats, level, exp, star, equipped, created_at)
         VALUES (?, ?, 0, NULL, 1, 0, 1, 0, ?)`,
        [userId, mount.id, now]
      );
    }
    return picks;
  };

  async function handleGiftCode(interaction, db, persist) {
    if (GIFT_CODE_CHANNEL_ID && interaction.channelId !== GIFT_CODE_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.giftCodeChannelOnly, ephemeral: true });
      return;
    }

    const codeInput = interaction.options.getString("code", true).trim().toLowerCase();
    if (!codeInput) {
      await interaction.reply({ content: "Gift code không hợp lệ.", ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(
        db,
        persist,
        member.id,
        getBaseNameFromMember ? getBaseNameFromMember(member) : (member.displayName || member.user.username),
        Date.now()
      );
    }

    user = applyPassiveExpForUser(db, persist, user);

    const gift = getGiftCode(db, codeInput);
    if (!gift || Number(gift.active || 0) === 0) {
      await interaction.reply({ content: "Gift code không tồn tại hoặc đã tắt.", ephemeral: true });
      return;
    }

    if (hasClaimed(db, codeInput, user.user_id)) {
      await interaction.reply({ content: "Bạn đã sử dụng gift code này rồi.", ephemeral: true });
      return;
    }

    if (gift.max_uses !== null && Number(gift.uses || 0) >= Number(gift.max_uses)) {
      await interaction.reply({ content: "Gift code đã hết lượt sử dụng.", ephemeral: true });
      return;
    }

    const now = Date.now();
    const currencyReward = Number(gift.currency || 0);
    const mountCount = Number(gift.mount_count || 0);

    db.run("BEGIN");
    if (currencyReward > 0) {
      db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [
        currencyReward,
        user.user_id,
      ]);
    }
    const grantedMounts = grantMounts(db, user.user_id, mountCount);
    db.run(
      "INSERT INTO giftcode_claims (code, user_id, claimed_at) VALUES (?, ?, ?)",
      [codeInput, user.user_id, now]
    );
    db.run(
      "UPDATE giftcodes SET uses = uses + 1 WHERE code = ?",
      [codeInput]
    );
    db.run("COMMIT");
    persist();

    const mountLine = grantedMounts.length
      ? grantedMounts.map((m) => `• ${m.name} (ID ${m.id})`).join("\n")
      : "Không có thú cưỡi mới (đã sở hữu hoặc chưa có dữ liệu thú cưỡi).";

    await interaction.reply({
      embeds: [
        {
          color: 0x2ecc71,
          title: "🎁 Nhận giftcode thành công",
          description:
            `+${formatNumber(currencyReward)} ${CURRENCY_NAME}\n` +
            `Thú cưỡi nhận được: ${grantedMounts.length}/${mountCount}`,
          fields: [
            {
              name: "Chi tiết thú cưỡi",
              value: mountLine,
            },
          ],
          timestamp: new Date(),
        },
      ],
      ephemeral: false,
    });
  }

  return {
    handleGiftCode,
    ensureGiftCode,
  };
}

module.exports = createGiftCodeService;
