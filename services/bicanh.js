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
  BICANH_DAILY_CHALLENGES,
  expToNext,
  INFO_CHANNEL_ID,
  updateNickname,
}) {
  let farmTimer = null;
  const MAX_FARM_CATCHUP_TICKS = 360; // 6 hours
  const LINH_THACH_RATE = 5000; // per level per minute base
  const EXP_RATE = 1000; // exp per level per minute base

  const getBicanhLevel = (db, userId) => {
    const stmt = db.prepare("SELECT bicanh_level FROM users WHERE user_id = ?");
    stmt.bind([userId]);
    const has = stmt.step();
    const level = has ? Number(stmt.getAsObject().bicanh_level || 1) : 1;
    stmt.free();
    return Math.max(1, level);
  };

  const setBicanhLevel = (db, persist, userId, level) => {
    const next = Math.max(1, Math.floor(level));
    db.run("UPDATE users SET bicanh_level = ? WHERE user_id = ?", [next, userId]);
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

  const getChallengeCount = (db, userId, dayKey) => {
    const stmt = db.prepare(
      "SELECT COUNT(*) as cnt FROM bicanh_challenges WHERE user_id = ? AND day_key = ?"
    );
    stmt.bind([userId, dayKey]);
    const has = stmt.step();
    const cnt = has ? Number(stmt.getAsObject().cnt || 0) : 0;
    stmt.free();
    return cnt;
  };

  const addChallengeEntry = (db, persist, userId, dayKey) => {
    db.run(
      `INSERT INTO bicanh_challenges (user_id, day_key)
       VALUES (?, ?)`
    , [userId, dayKey]);
    persist();
  };

  const todayKey = () => {
    const now = new Date();
    // Convert to GMT+7
    const offsetMs = 7 * 60 * 60 * 1000;
    const local = new Date(now.getTime() + offsetMs);
    return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
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

    const level = getBicanhLevel(db, user.user_id);
    const stats = getDefenderStats(level);
    await interaction.reply({
      embeds: [
        {
          color: 0x3498db,
          title: `🛡️ Thủ vệ hầm ngục tầng ${level}`,
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
          footer: { text: "/khieuchienhamnguc để khiêu chiến" },
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

    const dayKey = todayKey();
    const used = getChallengeCount(db, user.user_id, dayKey);
    const haveTurn = BICANH_DAILY_CHALLENGES - used;
    if (used >= BICANH_DAILY_CHALLENGES) {
      await interaction.reply({ content: `${TEXT.bicanhChallengeLimit} ${TEXT.bicanhChallengeReset}`, ephemeral: true });
      return;
    }

    const guardLevel = getBicanhLevel(db, user.user_id);
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
      newLevel = setBicanhLevel(db, persist, user.user_id, guardLevel + 1);
    }

    addChallengeEntry(db, persist, user.user_id, dayKey);

    const logText = result.rounds.map((l, idx) => `${idx + 1}. ${l}`).join("\n");

    await interaction.reply({
      embeds: [
        {
          color: playerWin ? 0x2ecc71 : 0xe74c3c,
          title: `⚔️ Khiêu chiến hầm ngục tầng ${guardLevel}`,
          description:
            `${playerWin ? "✅ Bạn đã thắng!" : "❌ Bạn thất bại."}\n` +
            (playerWin ? `Hầm ngục lên level **${newLevel}**.` : "") +
            `\n\nLog (${result.totalRounds} hiệp):\n${logText}`,
          footer: { text: `Lượt còn lại: ${haveTurn}/${BICANH_DAILY_CHALLENGES}` },
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

    const guardLevel = getBicanhLevel(db, interaction.user.id);
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
      await interaction.reply({ content: "Không thể tạo thread trong kênh hầm ngục.", ephemeral: true });
      return;
    }

    const thread = await channel.threads.create({
      name: `Hầm ngục của ${member.user.username}`.slice(0, 90),
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
    });

    const message = await thread.send(
      `⛏️ Farm hầm ngục bắt đầu\nThủ vệ hiện tại tầng ${guardLevel}\nĐang chờ tick đầu tiên...`
    );

    saveFarmSession(db, persist, {
      user_id: user.user_id,
      thread_id: thread.id,
      message_id: message.id,
      last_tick: Date.now(),
      total_earned: 0,
    });

    await interaction.reply({
      content: `Đã bắt đầu farm hầm ngục cho bạn tại thread ${thread.toString()}.`,
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

    const guardLevel = getBicanhLevel(db, user.user_id);
    if (guardLevel <= 1) {
      await interaction.reply({ content: "Cần thắng thủ vệ ít nhất 1 lần (lv > 1) để farm.", ephemeral: true });
      return;
    }

    const session = getFarmSession(db, user.user_id);
    if (!session) {
      await interaction.reply({ content: "Bạn chưa bắt đầu farm hầm ngục.", ephemeral: true });
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
            `⛏️ Farm hầm ngục\n` +
            `Tầng ${guardLevel}\n` +
            `Nhận mới: +0 ${CURRENCY_NAME}\n` +
            `Tổng tích lũy: 0 ${CURRENCY_NAME}\n` +
            `Cập nhật: ${new Date(now).toLocaleString("vi-VN")}`;
          await message.edit({ content });
        }
      }
    } catch (error) {
      console.error("Update farm message after claim failed:", error);
    }

    // Tính thời gian farm dựa vào số lượng nhận được
    const avgMinutes = Math.round(pending / (guardLevel * LINH_THACH_RATE));
    const hours = Math.floor(avgMinutes / 60);
    const minutes = avgMinutes % 60;
    const timeStr = hours > 0 ? `${hours} giờ ${minutes} phút` : `${minutes} phút`;

    await interaction.reply({
      embeds: [
        {
          color: 0x2ecc71,
          title: "⛏️ Nhận thưởng hầm ngục",
          description:
            `Đã nhận **${formatNumber(pending)} ${CURRENCY_NAME}**\n` +
            `Thời gian farm: **${timeStr}**\n` +
            `Tầng hầm ngục: **${guardLevel}**`,
          timestamp: new Date(),
        },
      ],
      ephemeral: false,
    });
  }

  async function processFarmTick() {
    const client = clientRefGetter();
    if (!client) return;

    const updates = await withDatabase((db, persist) => {
      const sessions = getFarmSessions(db);
      const now = Date.now();
      const results = [];

      db.run("BEGIN");
      sessions.forEach((s) => {
        const guardLevel = getBicanhLevel(db, s.user_id);
        const ticks = Math.floor((now - s.last_tick) / FARM_INTERVAL_MS);
        if (ticks <= 0) return;

        if (guardLevel <= 1) {
          db.run("UPDATE farm_sessions SET last_tick = ? WHERE user_id = ?", [now, s.user_id]);
          return;
        }

        const cappedTicks = Math.min(ticks, MAX_FARM_CATCHUP_TICKS);
        let delta = 0;
        let expDelta = 0;
        for (let i = 0; i < cappedTicks; i++) {
          const roll = 0.8 + Math.random() * 0.4;
          delta += Math.round(guardLevel * LINH_THACH_RATE * roll);
          expDelta += Math.round(guardLevel * EXP_RATE * roll);
        }
        const newLast = s.last_tick + cappedTicks * FARM_INTERVAL_MS;
        db.run(
          "UPDATE farm_sessions SET last_tick = ?, total_earned = total_earned + ? WHERE user_id = ?",
          [newLast, delta, s.user_id]
        );
        db.run(
          "UPDATE users SET exp = exp + ? WHERE user_id = ?",
          [expDelta, s.user_id]
        );

        // Check for level up
        const user = getUser(db, s.user_id);
        let levelUps = 0;
        let currentLevel = user ? user.level : 1;
        let currentExp = user ? user.exp : 0;
        const oldLevel = currentLevel;

        while (true) {
          const required = expToNext(currentLevel);
          if (currentExp < required) break;
          currentExp -= required;
          currentLevel += 1;
          levelUps += 1;
        }

        if (levelUps > 0) {
          db.run("UPDATE users SET level = ?, exp = ? WHERE user_id = ?", [
            currentLevel,
            currentExp,
            s.user_id,
          ]);
        }

        results.push({
          user_id: s.user_id,
          thread_id: s.thread_id,
          message_id: s.message_id,
          added: delta,
          expAdded: expDelta,
          ticks: cappedTicks,
          guardLevel,
          newLast,
          total: s.total_earned + delta,
          levelUps,
          oldLevel,
          newLevel: currentLevel,
          newExp: currentExp,
          baseName: user ? user.base_name : "Hiệp Khách",
          currency: user ? user.currency : 0,
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
          `⛏️ Farm hầm ngục\n` +
          `Tầng ${upd.guardLevel}\n` +
          `Nhận mới: +${formatNumber(upd.added)} ${CURRENCY_NAME} & +${formatNumber(upd.expAdded)} EXP (${upd.ticks} phút)\n` +
          `Tổng tích lũy: ${formatNumber(upd.total)} ${CURRENCY_NAME}\n` +
          `Cập nhật: ${new Date().toLocaleString("vi-VN")}`;
        await message.edit({ content });

        // Send level up embed to INFO_CHANNEL_ID if player leveled up
        if (upd.levelUps > 0 && INFO_CHANNEL_ID) {
          try {
            const infoChannel = await client.channels.fetch(INFO_CHANNEL_ID);
            if (infoChannel) {
              const nextLevelInt = upd.newLevel + 1;
              await infoChannel.send({
                embeds: [
                  {
                    color: 0xffd700,
                    title: "🎉 LEVEL UP!",
                    description:
                      `👤 <@${upd.user_id}>\n` +
                      `🔺 **Level:** ${upd.oldLevel} → ${upd.newLevel}\n` +
                      `✨ **Exp còn lại:** ${formatNumber(upd.newExp)}\n` +
                      `✨ **Exp level tiếp theo:** ${formatNumber(expToNext(nextLevelInt))}\n` +
                      `💰 **${CURRENCY_NAME}:** ${formatNumber(upd.currency)}`,
                    timestamp: new Date().toISOString(),
                  },
                ],
              });
            }

            try {
              const member = await thread.guild.members.fetch(upd.user_id);
              if (member) {
                await updateNickname(member, upd.baseName, upd.newLevel);
              }
            } catch (error) {
              console.error("Update nickname on level up failed:", error);
            }
          } catch (error) {
            console.error("Send level up notification failed:", error);
          }

          // Update nickname when level up
          
        }
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
