const { ChannelType } = require("discord.js");

function createBicanhService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  applyLevelBonus,
  getBaseNameFromMember,
  formatNumber,
  CURRENCY_NAME,
  TEXT,
  BICANH_CHANNEL_ID,
  FARM_INTERVAL_MS,
  simulateCombat,
  clientRefGetter,
}) {
  let farmTimer = null;
  const MAX_FARM_CATCHUP_TICKS = 360; // 6 hours

  const getBicanhLevel = (db) => {
    const stmt = db.prepare("SELECT level FROM bicanh_state WHERE id = 1");
    const has = stmt.step();
    const level = has ? Number(stmt.getAsObject().level || 1) : 1;
    stmt.free();
    return Math.max(1, level);
  };

  const setBicanhLevel = (db, persist, level) => {
    const next = Math.max(1, Math.floor(level));
    db.run("UPDATE bicanh_state SET level = ? WHERE id = 1", [next]);
    persist();
    return next;
  };

  const getDefenderStats = (level) => {
    const lvl = Math.max(1, Number(level) || 1);
    const increments = Math.max(0, lvl - 1);
    const flat = increments * 25000;
    const percent = increments;
    return {
      level: lvl,
      attack: flat,
      defense: flat,
      health: flat,
      dodge: percent,
      accuracy: percent,
      crit_rate: percent,
      crit_resistance: percent,
      armor_penetration: percent,
      armor_resistance: percent,
    };
  };

  const getFarmSessions = (db) => {
    const stmt = db.prepare(
      "SELECT user_id, thread_id, message_id, last_tick, total_earned FROM farm_sessions"
    );
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  };

  const getFarmSession = (db, userId) => {
    const stmt = db.prepare(
      "SELECT user_id, thread_id, message_id, last_tick, total_earned FROM farm_sessions WHERE user_id = ?"
    );
    stmt.bind([userId]);
    const has = stmt.step();
    const row = has ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  };

  const saveFarmSession = (db, persist, session) => {
    db.run(
      `INSERT INTO farm_sessions (user_id, thread_id, message_id, last_tick, total_earned)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           message_id = excluded.message_id,
           last_tick = excluded.last_tick,
           total_earned = excluded.total_earned`,
      [
        session.user_id,
        session.thread_id,
        session.message_id,
        session.last_tick,
        session.total_earned || 0,
      ]
    );
    persist();
  };

  async function handleBicanh(interaction, db, persist) {
    if (BICANH_CHANNEL_ID && interaction.channelId !== BICANH_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.bicanhChannelOnly, ephemeral: true });
      return;
    }

    const level = getBicanhLevel(db);
    const stats = getDefenderStats(level);
    await interaction.reply({
      embeds: [
        {
          color: 0x3498db,
          title: `🛡️ Thủ vệ bí cảnh - Level ${level}`,
          description:
            `ATK: ${formatNumber(stats.attack)}\n` +
            `DEF: ${formatNumber(stats.defense)}\n` +
            `HP: ${formatNumber(stats.health)}\n` +
            `Tỉ lệ chí mạng: ${formatNumber(stats.crit_rate)}%\n` +
            `Kháng chí mạng: ${formatNumber(stats.crit_resistance)}%\n` +
            `Né tránh: ${formatNumber(stats.dodge)}%\n` +
            `Chính xác: ${formatNumber(stats.accuracy)}%\n` +
            `Xuyên giáp: ${formatNumber(stats.armor_penetration)}%\n` +
            `Kháng xuyên giáp: ${formatNumber(stats.armor_resistance)}%`,
          footer: { text: "/sotaithuve để tỉ thí" },
          timestamp: new Date(),
        },
      ],
      ephemeral: false,
    });
  }

  async function handleSoTaiThuVe(interaction, db, persist) {
    if (BICANH_CHANNEL_ID && interaction.channelId !== BICANH_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.bicanhChannelOnly, ephemeral: true });
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

    const guardLevel = getBicanhLevel(db);
    const guardStats = getDefenderStats(guardLevel);
    const effective = applyLevelBonus(
      {
        attack: user.attack,
        defense: user.defense,
        health: user.health,
      },
      user.level
    );

    const player = {
      id: "player",
      name: user.base_name,
      level: user.level,
      exp: user.exp,
      attack: effective.attack,
      defense: effective.defense,
      health: effective.health,
      dodge: user.dodge,
      accuracy: user.accuracy,
      crit_rate: user.crit_rate,
      crit_resistance: user.crit_resistance,
      armor_penetration: user.armor_penetration,
      armor_resistance: user.armor_resistance,
    };

    const defender = {
      id: "defender",
      name: `Thủ vệ Lv ${guardLevel}`,
      level: guardLevel,
      exp: 0,
      attack: guardStats.attack,
      defense: guardStats.defense,
      health: guardStats.health,
      dodge: guardStats.dodge,
      accuracy: guardStats.accuracy,
      crit_rate: guardStats.crit_rate,
      crit_resistance: guardStats.crit_resistance,
      armor_penetration: guardStats.armor_penetration,
      armor_resistance: guardStats.armor_resistance,
    };

    // Defender luôn đánh trước
    const result = simulateCombat(
      { ...defender, priority: 1 },
      { ...player, priority: 0 },
      { maxRounds: 50 }
    );
    const playerWin = result.winner === "player";

    let newLevel = guardLevel;
    if (playerWin) {
      newLevel = setBicanhLevel(db, persist, guardLevel + 1);
    }

    const logText = result.rounds.map((l, idx) => `${idx + 1}. ${l}`).join("\n");

    await interaction.reply({
      embeds: [
        {
          color: playerWin ? 0x2ecc71 : 0xe74c3c,
          title: `⚔️ So tài thủ vệ (Lv ${guardLevel})`,
          description:
            `${playerWin ? "✅ Bạn đã thắng!" : "❌ Bạn thất bại."}\n` +
            (playerWin ? `Thủ vệ lên level **${newLevel}**.` : "") +
            `\n\nLog (${result.totalRounds} hiệp):\n${logText}`,
          footer: { text: "/sotaithuve • /bicanh" },
          timestamp: new Date(),
        },
      ],
    });
  }

  async function handleFarmBicanh(interaction, db, persist) {
    if (BICANH_CHANNEL_ID && interaction.channelId !== BICANH_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.bicanhChannelOnly, ephemeral: true });
      return;
    }

    const guardLevel = getBicanhLevel(db);
    if (guardLevel <= 1) {
      await interaction.reply({ content: "Cần thắng thủ vệ ít nhất 1 lần (lv > 1) để farm.", ephemeral: true });
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

    const existing = getFarmSession(db, user.user_id);
    if (existing) {
      await interaction.reply({
        content: `Bạn đã có phiên farm. Thread: <#${existing.thread_id}>`,
        ephemeral: true,
      });
      return;
    }

    const channelId = BICANH_CHANNEL_ID || interaction.channelId;
    const channel = await interaction.guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: "Không thể tạo thread trong kênh bí cảnh.", ephemeral: true });
      return;
    }

    const thread = await channel.threads.create({
      name: `farm-bicanh-${member.user.username}`.slice(0, 90),
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
    });

    const message = await thread.send(
      `⛏️ Farm bí cảnh bắt đầu\nThủ vệ hiện tại: Level ${guardLevel}\nĐang chờ tick đầu tiên...`
    );

    saveFarmSession(db, persist, {
      user_id: user.user_id,
      thread_id: thread.id,
      message_id: message.id,
      last_tick: Date.now(),
      total_earned: 0,
    });

    await interaction.reply({
      content: `Đã bắt đầu farm bí cảnh cho bạn tại thread ${thread.toString()}.`,
      ephemeral: true,
    });
  }

  async function handleClaimFarm(interaction, db, persist) {
    if (BICANH_CHANNEL_ID && interaction.channelId !== BICANH_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.bicanhChannelOnly, ephemeral: true });
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

    const guardLevel = getBicanhLevel(db);
    if (guardLevel <= 1) {
      await interaction.reply({ content: "Cần thắng thủ vệ ít nhất 1 lần (lv > 1) để farm.", ephemeral: true });
      return;
    }

    const session = getFarmSession(db, user.user_id);
    if (!session) {
      await interaction.reply({ content: "Bạn chưa bắt đầu farm bí cảnh.", ephemeral: true });
      return;
    }

    const pending = Number(session.total_earned || 0);
    const now = Date.now();

    if (pending <= 0) {
      await interaction.reply({ content: "Không có thưởng để nhận.", ephemeral: true });
      return;
    }

    db.run("BEGIN");
    db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [pending, user.user_id]);
    db.run(
      "UPDATE farm_sessions SET total_earned = 0, last_tick = ? WHERE user_id = ?",
      [now, user.user_id]
    );
    db.run("COMMIT");
    persist();

    try {
      const client = clientRefGetter();
      if (client) {
        const thread = await client.channels.fetch(session.thread_id);
        if (thread) {
          const message = await thread.messages.fetch(session.message_id);
          const content =
            `⛏️ Farm bí cảnh\n` +
            `Thủ vệ: Level ${guardLevel}\n` +
            `Nhận mới: +0 ${CURRENCY_NAME}\n` +
            `Tổng tích lũy: 0 ${CURRENCY_NAME}\n` +
            `Cập nhật: ${new Date(now).toLocaleString("vi-VN")}`;
          await message.edit({ content });
        }
      }
    } catch (error) {
      console.error("Update farm message after claim failed:", error);
    }

    await interaction.reply({
      content: `Đã nhận **${formatNumber(pending)} ${CURRENCY_NAME}** từ farm bí cảnh.`,
      ephemeral: true,
    });
  }

  async function processFarmTick() {
    const client = clientRefGetter();
    if (!client) return;

    const updates = await withDatabase((db, persist) => {
      const guardLevel = getBicanhLevel(db);
      const sessions = getFarmSessions(db);
      const now = Date.now();
      const results = [];

      if (guardLevel <= 1) {
        sessions.forEach((s) => {
          db.run("UPDATE farm_sessions SET last_tick = ? WHERE user_id = ?", [now, s.user_id]);
        });
        persist();
        return results;
      }

      db.run("BEGIN");
      sessions.forEach((s) => {
        const ticks = Math.floor((now - s.last_tick) / FARM_INTERVAL_MS);
        if (ticks <= 0) return;

        const cappedTicks = Math.min(ticks, MAX_FARM_CATCHUP_TICKS);
        let delta = 0;
        for (let i = 0; i < cappedTicks; i++) {
          const roll = 0.8 + Math.random() * 0.4;
          delta += Math.round(guardLevel * 5000 * roll);
        }
        const newLast = s.last_tick + cappedTicks * FARM_INTERVAL_MS;
        db.run(
          "UPDATE farm_sessions SET last_tick = ?, total_earned = total_earned + ? WHERE user_id = ?",
          [newLast, delta, s.user_id]
        );
        results.push({
          user_id: s.user_id,
          thread_id: s.thread_id,
          message_id: s.message_id,
          added: delta,
          ticks: cappedTicks,
          guardLevel,
          newLast,
          total: s.total_earned + delta,
        });
      });
      db.run("COMMIT");
      persist();
      return results;
    });

    if (!updates || updates.length === 0) return;

    for (const upd of updates) {
      try {
        const thread = await client.channels.fetch(upd.thread_id);
        if (!thread) continue;
        const message = await thread.messages.fetch(upd.message_id);
        const content =
          `⛏️ Farm bí cảnh\n` +
          `Thủ vệ: Level ${upd.guardLevel}\n` +
          `Nhận mới: +${formatNumber(upd.added)} ${CURRENCY_NAME} (${upd.ticks} phút)\n` +
          `Tổng tích lũy: ${formatNumber(upd.total)} ${CURRENCY_NAME}\n` +
          `Cập nhật: ${new Date().toLocaleString("vi-VN")}`;
        await message.edit({ content });
      } catch (error) {
        console.error("Farm update failed:", error);
      }
    }
  }

  function startFarmLoop() {
    if (farmTimer) clearInterval(farmTimer);
    farmTimer = setInterval(processFarmTick, FARM_INTERVAL_MS);
    processFarmTick().catch((err) => console.error("Farm tick error:", err));
  }

  return {
    handleBicanh,
    handleSoTaiThuVe,
    handleFarmBicanh,
    handleClaimFarm,
    startFarmLoop,
    processFarmTick,
    getDefenderStats,
    getBicanhLevel,
  };
}

module.exports = createBicanhService;