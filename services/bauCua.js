const ROUND_STATUS = {
  WAITING: "waiting",
  RUNNING: "running",
  FINISHED: "finished",
};

function createBauCuaService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  BAUCUA_FACES,
  BAUCUA_CHANNEL_ID,
  BAUCUA_COUNTDOWN_MS,
  BAUCUA_LOCK_WINDOW_MS,
  clientRefGetter,
}) {
  const faceById = Object.fromEntries(BAUCUA_FACES.map((f) => [f.id, f]));
  let currentRound = null;
  let statusInterval = null;
  let closeTimeout = null;
  let finalizing = false;

  const getLastInsertId = (db) => {
    const res = db.exec("SELECT last_insert_rowid() AS id");
    return res && res[0] && res[0].values && res[0].values[0]
      ? Number(res[0].values[0][0])
      : null;
  };

  const mapRoundRow = (row) => ({
    id: Number(row.id),
    status: row.status,
    startedAt: row.started_at ? Number(row.started_at) : null,
    lockAt: row.lock_at ? Number(row.lock_at) : null,
    closeAt: row.close_at ? Number(row.close_at) : null,
    result: row.result1 ? [row.result1, row.result2, row.result3] : null,
    messageId: currentRound?.messageId || null,
  });

  const getChannel = async () => {
    if (!BAUCUA_CHANNEL_ID) return null;
    const client = clientRefGetter && clientRefGetter();
    if (!client) return null;
    const cached = client.channels.cache.get(BAUCUA_CHANNEL_ID);
    if (cached) return cached;
    try {
      return await client.channels.fetch(BAUCUA_CHANNEL_ID);
    } catch (error) {
      console.error("Không lấy được channel Bầu Cua:", error);
      return null;
    }
  };

  const getLatestRound = (db) => {
    const stmt = db.prepare(
      "SELECT id, status, started_at, lock_at, close_at, result1, result2, result3 FROM baucua_rounds ORDER BY id DESC LIMIT 1"
    );
    const hasRow = stmt.step();
    const round = hasRow ? mapRoundRow(stmt.getAsObject()) : null;
    stmt.free();
    return round;
  };

  const createWaitingRound = (db, persist) => {
    const now = Date.now();
    db.run("INSERT INTO baucua_rounds (status, created_at) VALUES (?, ?)", [
      ROUND_STATUS.WAITING,
      now,
    ]);
    const id = getLastInsertId(db);
    persist();
    currentRound = {
      id,
      status: ROUND_STATUS.WAITING,
      startedAt: null,
      lockAt: null,
      closeAt: null,
      result: null,
      messageId: null,
    };
    return currentRound;
  };

  const ensureCurrentRound = (db, persist) => {
    if (currentRound) return currentRound;
    const latest = getLatestRound(db);
    if (latest) {
      currentRound = latest;
    } else {
      currentRound = createWaitingRound(db, persist);
    }
    if (currentRound.status === ROUND_STATUS.RUNNING) {
      scheduleTimers();
    }
    return currentRound;
  };

  const startRound = async (db, persist, round) => {
    const now = Date.now();
    const closeAt = now + BAUCUA_COUNTDOWN_MS;
    const lockAt = closeAt - BAUCUA_LOCK_WINDOW_MS;
    db.run(
      "UPDATE baucua_rounds SET status = ?, started_at = ?, lock_at = ?, close_at = ? WHERE id = ?",
      [ROUND_STATUS.RUNNING, now, lockAt, closeAt, round.id]
    );
    persist();
    currentRound = {
      ...round,
      status: ROUND_STATUS.RUNNING,
      startedAt: now,
      lockAt,
      closeAt,
    };
    scheduleTimers();
    await refreshStatusMessage(currentRound, db);
    return currentRound;
  };

  const scheduleTimers = () => {
    clearInterval(statusInterval);
    clearTimeout(closeTimeout);
    if (!currentRound || currentRound.status !== ROUND_STATUS.RUNNING) return;
    const remaining = Math.max(0, currentRound.closeAt - Date.now());
    closeTimeout = setTimeout(() => finalizeRound(), remaining);
    statusInterval = setInterval(() => {
      withDatabase(async (db, persist) => {
        if (!currentRound) {
          ensureCurrentRound(db, persist);
        }
        await refreshStatusMessage(currentRound, db);
      }).catch((error) => console.error("Bầu cua ticker error:", error));
    }, 1000);
  };

  const rollResults = () => {
    const faces = BAUCUA_FACES;
    const results = [];
    for (let i = 0; i < 3; i++) {
      const pick = faces[Math.floor(Math.random() * faces.length)];
      results.push(pick);
    }
    return results;
  };

  const getBets = (db, roundId) => {
    const stmt = db.prepare(
      "SELECT user_id, face, amount FROM baucua_bets WHERE round_id = ?"
    );
    stmt.bind([roundId]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        user_id: row.user_id,
        face: row.face,
        amount: Number(row.amount || 0),
      });
    }
    stmt.free();
    return rows;
  };

  const getTotalsByFace = (db, roundId) => {
    const stmt = db.prepare(
      "SELECT face, user_id, SUM(amount) as total FROM baucua_bets WHERE round_id = ? GROUP BY face, user_id"
    );
    stmt.bind([roundId]);
    const totals = {};
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const face = row.face;
      if (!totals[face]) {
        totals[face] = { total: 0, users: [] };
      }
      totals[face].total += Number(row.total || 0);
      if (!totals[face].users.includes(row.user_id)) {
        totals[face].users.push(row.user_id);
      }
    }
    stmt.free();
    return totals;
  };

  const getAppearanceStats = (db) => {
    const stmt = db.prepare(
      "SELECT result1, result2, result3 FROM baucua_rounds WHERE result1 IS NOT NULL AND result2 IS NOT NULL AND result3 IS NOT NULL"
    );
    const counts = {};
    let total = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      [row.result1, row.result2, row.result3].forEach((face) => {
        if (!face) return;
        counts[face] = (counts[face] || 0) + 1;
        total += 1;
      });
    }
    stmt.free();
    return {counts, total};
  };

  const formatCountdown = (ms) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60)
      .toString()
      .padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const refreshStatusMessage = async (round, db) => {
    if (!round) return;
    const channel = await getChannel();
    if (!channel) return;

    const totals = getTotalsByFace(db, round.id);
    const totalPot = Object.values(totals).reduce(
      (sum, info) => sum + (info.total || 0),
      0
    );
    const {counts, total} = getAppearanceStats(db);
    const appearanceLine = total > 0
      ? BAUCUA_FACES.map((face) => {
          const pct = ((counts[face.id] || 0) / total) * 100;
          return `${face.emoji} ${pct.toFixed(1)}%`;
        }).join(" • ")
      : "Chưa có dữ liệu";
    const now = Date.now();
    const locked =
      round.status === ROUND_STATUS.RUNNING &&
      round.lockAt !== null &&
      now >= round.lockAt;
    const lines = BAUCUA_FACES.map((face) => {
      const info = totals[face.id] || { total: 0, users: [] };
      const mentions = info.users.map((id) => `<@${id}>`).join(", ");
      return `${face.emoji} ${face.label}: **${formatNumber(
        info.total
      )} ${CURRENCY_NAME}**${mentions ? ` • ${mentions}` : ""}`;
    }).join("\n");

    const baseDescription =
      round.status === ROUND_STATUS.RUNNING
        ? locked
          ? TEXT.bauCuaLocked
          : `Còn: **${formatCountdown(round.closeAt - now)}**`
        : TEXT.bauCuaWaiting;

    const embed = {
      color: locked ? 0xe67e22 : 0x1abc9c,
      title: `Bầu Cua - Ván #${round.id}`,
      description:
        `${baseDescription}\n` +
        `Khóa cược ${Math.floor(BAUCUA_LOCK_WINDOW_MS / 1000)}s cuối.\n\n${lines}`,
      fields: [
        {
          name: "Tổng Pot",
          value: `**${formatNumber(totalPot)} ${CURRENCY_NAME}**`,
        },
        {
          name: "Tỉ lệ xuất hiện (lịch sử)",
          value: appearanceLine,
        },
      ],
      footer: { text: "/baucua" },
      timestamp: new Date(),
    };

    try {
      if (round.messageId) {
        const msg = await channel.messages.fetch(round.messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed] });
          return;
        }
      }
      const sent = await channel.send({ embeds: [embed] });
      currentRound = { ...round, messageId: sent.id };
    } catch (error) {
      console.error("Không thể cập nhật trạng thái Bầu Cua:", error);
    }
  };

  const finalizeRound = async () => {
    if (finalizing) return;
    finalizing = true;
    clearInterval(statusInterval);
    clearTimeout(closeTimeout);
    try {
      await withDatabase(async (db, persist) => {
        const round = ensureCurrentRound(db, persist);
        if (!round || round.status !== ROUND_STATUS.RUNNING) return;

        const results = rollResults();
        const bets = getBets(db, round.id);
        const counts = results.reduce((acc, face) => {
          acc[face.id] = (acc[face.id] || 0) + 1;
          return acc;
        }, {});

        const winnings = {};
        let totalPot = 0;
        bets.forEach((bet) => {
          totalPot += bet.amount;
          const match = counts[bet.face] || 0;
          if (match > 0) {
            winnings[bet.user_id] =
              (winnings[bet.user_id] || 0) + bet.amount * match;
          }
        });

        db.run("BEGIN");
        Object.entries(winnings).forEach(([userId, amount]) => {
          db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [
            amount,
            userId,
          ]);
        });
        db.run(
          "UPDATE baucua_rounds SET status = ?, result1 = ?, result2 = ?, result3 = ? WHERE id = ?",
          [
            ROUND_STATUS.FINISHED,
            results[0].id,
            results[1].id,
            results[2].id,
            round.id,
          ]
        );
        db.run("COMMIT");
        persist();

        await sendResultMessage(round, results, winnings, totalPot, db);
        currentRound = createWaitingRound(db, persist);
        await refreshStatusMessage(currentRound, db);
      });
    } catch (error) {
      console.error("Lỗi chốt ván Bầu Cua:", error);
    } finally {
      finalizing = false;
    }
  };

  const sendResultMessage = async (round, results, winnings, totalPot, db) => {
    const channel = await getChannel();
    if (!channel) return;

    const resultLine = results.map((r) => `${r.emoji} ${r.label}`).join(" • ");

    const winnerEntries = Object.entries(winnings).map(([userId, amount]) => {
      const user = getUser(db, userId);
      const name = user?.base_name || userId;
      return { userId, name, amount };
    });

    winnerEntries.sort((a, b) => b.amount - a.amount);
    const winnerText =
      winnerEntries.length === 0
        ? TEXT.bauCuaNoBets
        : winnerEntries
            .map(
              (w) =>
                `• <@${w.userId}> (${w.name}): **${formatNumber(
                  w.amount
                )} ${CURRENCY_NAME}**`
            )
            .join("\n");

    const embed = {
      color: 0xe67e22,
      title: `${TEXT.bauCuaResultTitle} - Ván #${round.id}`,
      description:
        `Kết quả: ${resultLine}\n` +
        `Tổng pot: **${formatNumber(totalPot)} ${CURRENCY_NAME}**`,
      fields: [
        {
          name: "Thắng thưởng",
          value: winnerText,
        },
      ],
      timestamp: new Date(),
    };

    await channel.send({ embeds: [embed] });
  };

  const handleBet = async (interaction, db, persist) => {
    if (BAUCUA_CHANNEL_ID && interaction.channelId !== BAUCUA_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.bauCuaChannelOnly, ephemeral: true });
      return;
    }

    const faceId = interaction.options.getString("linhvat", true);
    const amount = Number(interaction.options.getInteger("cuoc", true));
    const face = faceById[faceId];
    if (!face) {
      await interaction.reply({ content: "Lựa chọn không hợp lệ.", ephemeral: true });
      return;
    }

    if (amount <= 0) {
      await interaction.reply({ content: TEXT.bauCuaMinBet, ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(
        db,
        persist,
        member.id,
        getBaseNameFromMember(member),
        Date.now()
      );
    }

    user = applyPassiveExpForUser(db, persist, user);

    if (user.currency < amount) {
      await interaction.reply({ content: TEXT.bauCuaInsufficient, ephemeral: true });
      return;
    }

    let round = ensureCurrentRound(db, persist);
    const now = Date.now();

    if (round.status === ROUND_STATUS.RUNNING && round.lockAt && now >= round.lockAt) {
      await interaction.reply({ content: TEXT.bauCuaLocked, ephemeral: true });
      return;
    }

    if (round.status === ROUND_STATUS.WAITING) {
      round = await startRound(db, persist, round);
    }

    db.run("BEGIN");
    db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [
      amount,
      user.user_id,
    ]);
    db.run(
      `INSERT INTO baucua_bets (round_id, user_id, face, amount)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(round_id, user_id, face) DO UPDATE SET amount = baucua_bets.amount + excluded.amount`,
      [round.id, user.user_id, face.id, amount]
    );
    db.run("COMMIT");
    persist();

    await refreshStatusMessage(round, db);

    const lockedWarning =
      round.lockAt && now < round.lockAt
        ? `Khóa cược sau ${formatCountdown(round.lockAt - now)}.`
        : TEXT.bauCuaLocked;

    await interaction.reply({
      content: `${TEXT.bauCuaBetPlaced} ${face.emoji} ${face.label} - ${formatNumber(
        amount
      )} ${CURRENCY_NAME}. ${lockedWarning}`,
      ephemeral: true,
    });
  };

  const init = () => {
    withDatabase(async (db, persist) => {
      const round = ensureCurrentRound(db, persist);
      await refreshStatusMessage(round, db);
      if (round.status === ROUND_STATUS.RUNNING) {
        scheduleTimers();
      }
    }).catch((error) => console.error("Bầu cua init error:", error));
  };

  return {
    handleBet,
    init,
  };
}

module.exports = createBauCuaService;
