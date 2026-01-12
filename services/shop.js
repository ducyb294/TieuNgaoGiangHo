const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const STAT_CONFIG = [
  { id: "attack", label: "ATK", base: 10000, type: "flat" },
  { id: "defense", label: "DEF", base: 10000, type: "flat" },
  { id: "health", label: "HP", base: 10000, type: "flat" },
  { id: "dodge", label: "Né tránh (%)", base: 50000, type: "percent" },
  { id: "accuracy", label: "Chính xác (%)", base: 50000, type: "percent" },
  { id: "crit_rate", label: "Tỉ lệ chí mạng (%)", base: 50000, type: "percent" },
  { id: "crit_resistance", label: "Kháng chí mạng (%)", base: 50000, type: "percent" },
  { id: "armor_penetration", label: "Xuyên giáp (%)", base: 50000, type: "percent" },
  { id: "armor_resistance", label: "Kháng xuyên giáp (%)", base: 50000, type: "percent" },
];

function price(base, n) {
  const r = 0.12;
  const k = 2.3;
  return Math.floor(base * Math.pow(1 + r * n, k));
}

function createShopService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  SHOP_CHANNEL_ID,
}) {
  const statById = Object.fromEntries(STAT_CONFIG.map((s) => [s.id, s]));

  const getPurchaseCount = (db, userId, statId) => {
    const stmt = db.prepare(
      "SELECT count FROM shop_purchases WHERE user_id = ? AND stat_id = ?"
    );
    stmt.bind([userId, statId]);
    const has = stmt.step();
    const count = has ? Number(stmt.getAsObject().count || 0) : 0;
    stmt.free();
    return count;
  };

  const setPurchaseCount = (db, userId, statId, count) => {
    db.run(
      `INSERT INTO shop_purchases (user_id, stat_id, count)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, stat_id) DO UPDATE SET count = excluded.count`,
      [userId, statId, count]
    );
  };

  const getAllCounts = (db, userId) => {
    const stmt = db.prepare("SELECT stat_id, count FROM shop_purchases WHERE user_id = ?");
    stmt.bind([userId]);
    const map = {};
    while (stmt.step()) {
      const row = stmt.getAsObject();
      map[row.stat_id] = Number(row.count || 0);
    }
    stmt.free();
    return map;
  };

  const calcGain = (statId, qty) => {
    const cfg = statById[statId];
    if (!cfg) return { amount: 0, label: "" };
    if (cfg.type === "flat") {
      let total = 0;
      for (let i = 0; i < qty; i++) {
        const roll = 0.8 + Math.random() * 0.4; // 80% - 120%
        total += Math.round(1000 * roll);
      }
      return { amount: total, label: `${formatNumber(total)} ${cfg.label}` };
    }
    return { amount: qty, label: `${formatNumber(qty)} ${cfg.label}` };
  };

  const calcCost = (statId, currentCount, qty) => {
    const cfg = statById[statId];
    if (!cfg) return 0;
    let total = 0;
    for (let i = 0; i < qty; i++) {
      const n = currentCount + i;
      total += price(cfg.base, n);
    }
    return total;
  };

  const applyPurchase = (db, persist, user, statId, qty) => {
    const currentCount = getPurchaseCount(db, user.user_id, statId);
    const cost = calcCost(statId, currentCount, qty);
    if (user.currency < cost) {
      return { ok: false, reason: "not_enough" };
    }
    const gain = calcGain(statId, qty);

    db.run("BEGIN");
    db.run(
      `UPDATE users SET currency = currency - ?, ${statId} = ${statId} + ? WHERE user_id = ?`,
      [cost, gain.amount, user.user_id]
    );
    setPurchaseCount(db, user.user_id, statId, currentCount + qty);
    db.run("COMMIT");
    persist();

    const refreshed = getUser(db, user.user_id);
    return { ok: true, cost, gain, updatedUser: refreshed, countAfter: currentCount + qty };
  };

  const buildShopMessage = (user, counts) => {
    const rows = [];
    const buttons = STAT_CONFIG.map((cfg) =>
      new ButtonBuilder()
        .setCustomId(`shop:${cfg.id}`)
        .setLabel(`${cfg.label} (${formatNumber(calcCost(cfg.id, counts[cfg.id] || 0, 1))})`)
        .setStyle(ButtonStyle.Primary)
    );
    // split into rows of 3
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 3)));
    }

    const descLines = STAT_CONFIG.map((cfg) => {
      const nextCost = calcCost(cfg.id, counts[cfg.id] || 0, 1);
      return `• ${cfg.label}: ${formatNumber(nextCost)} ${CURRENCY_NAME} (lần mua tiếp theo)`;
    }).join("\n");

    const embed = {
      color: 0xf39c12,
      title: "🛒 Shop chỉ số",
      description:
        `Số dư: **${formatNumber(user.currency)} ${CURRENCY_NAME}**\n` +
        `Mua 1 lần mỗi nút. ATK/DEF/HP nhận ngẫu nhiên ~1000 (±20%), các chỉ số khác +1%.\n\n${descLines}`,
      footer: { text: "/muasll để mua số lượng lớn" },
      timestamp: new Date(),
    };

    return { embed, components: rows };
  };

  async function handleShop(interaction, db, persist) {
    if (SHOP_CHANNEL_ID && interaction.channelId !== SHOP_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.shopChannelOnly, ephemeral: true });
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

    const counts = getAllCounts(db, user.user_id);
    const { embed, components } = buildShopMessage(user, counts);

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: false,
    });
  }

  async function handleBulkPurchase(interaction, db, persist) {
    if (SHOP_CHANNEL_ID && interaction.channelId !== SHOP_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.shopChannelOnly, ephemeral: true });
      return;
    }

    const statId = interaction.options.getString("id", true);
    const qty = Math.max(1, interaction.options.getInteger("soluong", true));
    const cfg = statById[statId];
    if (!cfg) {
      await interaction.reply({ content: "Chỉ số không hợp lệ.", ephemeral: true });
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

    const currentCount = getPurchaseCount(db, user.user_id, statId);
    const cost = calcCost(statId, currentCount, qty);
    if (user.currency < cost) {
      await interaction.reply({
        content: `${TEXT.notEnoughCurrency} Cần ${formatNumber(cost)} ${CURRENCY_NAME}, bạn có ${formatNumber(
          user.currency
        )}.`,
        ephemeral: true,
      });
      return;
    }

    const result = applyPurchase(db, persist, user, statId, qty);
    if (!result.ok) {
      await interaction.reply({ content: TEXT.notEnoughCurrency, ephemeral: true });
      return;
    }

    const updated = result.updatedUser;
    await interaction.reply({
      embeds: [
        {
          color: 0xf1c40f,
          title: `🛒 Mua ${cfg.label}`,
          description:
            `Đã mua ${qty} lần ${cfg.label} với giá **${formatNumber(result.cost)} ${CURRENCY_NAME}**.\n` +
            `Nhận: **${result.gain.label}**\n` +
            `Số dư còn: **${formatNumber(updated.currency)} ${CURRENCY_NAME}**`,
          timestamp: new Date(),
        },
      ],
      ephemeral: true,
    });
  }

  async function handleButton(interaction, db, persist) {
    const [prefix, statId] = (interaction.customId || "").split(":");
    if (prefix !== "shop") return false;

    const cfg = statById[statId];
    if (!cfg) {
      await interaction.reply({ content: "Chỉ số không hợp lệ.", ephemeral: true });
      return true;
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

    const result = applyPurchase(db, persist, user, statId, 1);
    if (!result.ok) {
      await interaction.reply({ content: TEXT.notEnoughCurrency, ephemeral: true });
      return true;
    }

    const updated = result.updatedUser;
    await interaction.reply({
      embeds: [
        {
          color: 0xf39c12,
          title: `🛒 Mua ${cfg.label}`,
          description:
            `Đã mua 1 lần ${cfg.label} giá **${formatNumber(result.cost)} ${CURRENCY_NAME}**.\n` +
            `Nhận: **${result.gain.label}**\n` +
            `Số dư còn: **${formatNumber(updated.currency)} ${CURRENCY_NAME}**`,
          timestamp: new Date(),
        },
      ],
      ephemeral: true,
    });
    return true;
  }

  return {
    handleShop,
    handleBulkPurchase,
    handleButton,
  };
}

module.exports = createShopService;
