const RESULT_URL = "https://www.minhngoc.com.vn/getkqxs/mien-bac.js";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const BET_CUTOFF_HOUR = 18; // GMT+7
const RESULT_HOUR = 18;
const RESULT_MINUTE = 35;
const PAGE_SIZE = 15;

function getVietnamDateParts(timestamp = Date.now()) {
  const d = new Date(timestamp + VN_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

function formatDayKeyFromParts(parts) {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function getVietnamDayKey(timestamp = Date.now()) {
  return formatDayKeyFromParts(getVietnamDateParts(timestamp));
}

function addDaysToKey(dayKey, days) {
  const [y, m, d] = dayKey.split("-").map((v) => Number(v));
  const base = Date.UTC(y, m - 1, d);
  const next = new Date(base + days * 24 * 60 * 60 * 1000);
  return formatDayKeyFromParts({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

function getTargetBetDayKey(timestamp = Date.now()) {
  const parts = getVietnamDateParts(timestamp);
  const todayKey = formatDayKeyFromParts(parts);
  return parts.hour >= BET_CUTOFF_HOUR ? addDaysToKey(todayKey, 1) : todayKey;
}

function parseResultDateKey(text) {
  const dateMatch = text.match(/KQXS Miền Bắc[\s\S]*?Ngày:\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!dateMatch) return null;
  const [day, month, year] = dateMatch[1].split("/").map((v) => Number(v));
  const monthStr = String(month).padStart(2, "0");
  const dayStr = String(day).padStart(2, "0");
  return `${year}-${monthStr}-${dayStr}`;
}

function parseResults(text) {
  const blockMatch = text.match(/KQXS Miền Bắc[\s\S]*?(Giải bảy[^\n]*)/i);
  const block = blockMatch ? blockMatch[0] : text;
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let dbNumber = null;
  const allNumbers = [];
  for (const line of lines) {
    if (!line.startsWith("Giải")) continue;
    const nums = line.match(/\d+/g) || [];
    if (line.startsWith("Giải ĐB") && nums.length) {
      dbNumber = nums[0];
    }
    allNumbers.push(...nums);
  }
  const last2 = allNumbers.map((n) => n.slice(-2).padStart(2, "0"));
  return { dbNumber, last2, lines };
}

function splitLines(lines, size) {
  const pages = [];
  for (let i = 0; i < lines.length; i += size) {
    pages.push(lines.slice(i, i + size));
  }
  return pages.length ? pages : [[]];
}

function formatDayLabel(dayKey) {
  const [y, m, d] = dayKey.split("-");
  return `${d}/${m}/${y}`;
}

function buildLodeListEmbed(userId, dayKey, lines, pageIndex) {
  const pages = splitLines(lines, PAGE_SIZE);
  const page = Math.min(Math.max(0, pageIndex), pages.length - 1);
  const description = pages[page].length ? pages[page].join("\n") : "Chưa có dữ liệu.";
  return {
    embed: {
      color: 0x3498db,
      title: "Danh sách lô/đề đã đánh",
      description,
      footer: { text: `Ngày ${formatDayLabel(dayKey)} • Trang ${page + 1}/${pages.length}` },
      timestamp: new Date(),
    },
    totalPages: pages.length,
    page,
  };
}

function buildResultEmbeds(dayKey, resultLines, winnerLines) {
  const pages = splitLines(winnerLines, PAGE_SIZE);
  const embeds = [];
  const baseDescription = resultLines.join("\n");

  if (pages.length === 1 && pages[0].length === 0) {
    embeds.push({
      color: 0x2ecc71,
      title: `Kết quả KQXS miền Bắc (${formatDayLabel(dayKey)})`,
      description: baseDescription + "\n\nKhông có người trúng thưởng.",
      timestamp: new Date(),
    });
    return embeds;
  }

  pages.forEach((page, idx) => {
    const desc = page.length
      ? `${baseDescription}\n\n**Người trúng thưởng**\n${page.join("\n")}`
      : `${baseDescription}\n\nKhông có người trúng thưởng.`;
    embeds.push({
      color: 0x2ecc71,
      title: `Kết quả KQXS miền Bắc (${formatDayLabel(dayKey)})`,
      description: desc,
      footer: pages.length > 1 ? { text: `Trang ${idx + 1}/${pages.length}` } : undefined,
      timestamp: new Date(),
    });
  });

  return embeds;
}

function scheduleDaily(callback) {
  const now = Date.now();
  const parts = getVietnamDateParts(now);
  const targetParts = { ...parts, hour: RESULT_HOUR, minute: RESULT_MINUTE };
  const targetKey = formatDayKeyFromParts(targetParts);
  const targetBase = Date.UTC(parts.year, parts.month - 1, parts.day, RESULT_HOUR - 7, RESULT_MINUTE, 0, 0);
  let delay = targetBase - now;
  if (delay < 0) {
    const nextDay = addDaysToKey(targetKey, 1);
    const [y, m, d] = nextDay.split("-").map((v) => Number(v));
    const nextBase = Date.UTC(y, m - 1, d, RESULT_HOUR - 7, RESULT_MINUTE, 0, 0);
    delay = nextBase - now;
  }
  setTimeout(() => {
    callback();
    setInterval(callback, 24 * 60 * 60 * 1000);
  }, delay);
}

function createKqxsService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  KQXS_CHANNEL_ID,
  clientRefGetter,
}) {
  const ensureUser = async (interaction, db, persist) => {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }
    return applyPassiveExpForUser(db, persist, user);
  };

  const isValidNumber = (value) => /^\d{2}$/.test(value);

  const insertBet = (db, userId, dayKey, betType, betNumber, amount) => {
    db.run(
      `INSERT INTO lode_bets (user_id, day_key, bet_type, bet_number, amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, dayKey, betType, betNumber, amount, Date.now()]
    );
  };

  const getUserBets = (db, userId, dayKey) => {
    const stmt = db.prepare(
      `SELECT bet_type, bet_number, SUM(amount) AS total
       FROM lode_bets
       WHERE user_id = ? AND day_key = ?
       GROUP BY bet_type, bet_number
       ORDER BY bet_type ASC, bet_number ASC`
    );
    stmt.bind([userId, dayKey]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  };

  const getAllBets = (db, dayKey) => {
    const stmt = db.prepare(
      `SELECT user_id, bet_type, bet_number, SUM(amount) AS total
       FROM lode_bets
       WHERE day_key = ?
       GROUP BY user_id, bet_type, bet_number
       ORDER BY user_id ASC`
    );
    stmt.bind([dayKey]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  };

  const getLastDayProcessed = (db) => {
    const stmt = db.prepare("SELECT last_day_key FROM kqxs_state WHERE id = 1");
    const has = stmt.step();
    const row = has ? stmt.getAsObject() : null;
    stmt.free();
    return row?.last_day_key || null;
  };

  const setLastDayProcessed = (db, dayKey) => {
    db.run("UPDATE kqxs_state SET last_day_key = ? WHERE id = 1", [dayKey]);
  };

  async function handleDanh(interaction, db, persist, betType) {
    if (KQXS_CHANNEL_ID && interaction.channelId !== KQXS_CHANNEL_ID) {
      await interaction.reply({
        embeds: [
          {
            color: 0xe74c3c,
            title: "Không đúng kênh",
            description: TEXT.kqxsChannelOnly,
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const betNumber = String(interaction.options.getString("so", true)).trim();
    const betAmount = Number(interaction.options.getInteger("cuoc", true));
    if (!isValidNumber(betNumber)) {
      await interaction.reply({
        embeds: [
          {
            color: 0xe74c3c,
            title: "Số không hợp lệ",
            description: "Vui lòng nhập số từ 00 đến 99.",
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const user = await ensureUser(interaction, db, persist);
    if (betAmount <= 0 || user.currency < betAmount) {
      await interaction.reply({
        embeds: [
          {
            color: 0xe74c3c,
            title: "Không đủ ngân lượng",
            description: `${TEXT.notEnoughCurrency} Bạn đang có ${formatNumber(user.currency)} ${CURRENCY_NAME}.`,
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const dayKey = getTargetBetDayKey();
    db.run("BEGIN");
    db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [
      betAmount,
      user.user_id,
    ]);
    insertBet(db, user.user_id, dayKey, betType, betNumber, betAmount);
    db.run("COMMIT");
    persist();

    await interaction.reply({
      embeds: [
        {
          color: 0x2ecc71,
          title: betType === "de" ? "Đánh đề thành công" : "Đánh lô thành công",
          description:
            `Số: **${betNumber}**\n` +
            `Cược: **${formatNumber(betAmount)} ${CURRENCY_NAME}**\n` +
            `Áp dụng cho ngày: **${formatDayLabel(dayKey)}**`,
          timestamp: new Date(),
        },
      ],
      ephemeral: false,
    });
  }

  async function handleLode(interaction, db, persist) {
    if (KQXS_CHANNEL_ID && interaction.channelId !== KQXS_CHANNEL_ID) {
      await interaction.reply({
        embeds: [
          {
            color: 0xe74c3c,
            title: "Không đúng kênh",
            description: TEXT.kqxsChannelOnly,
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const user = await ensureUser(interaction, db, persist);
    const dayKey = getTargetBetDayKey();
    const rows = getUserBets(db, user.user_id, dayKey);
    const lines = rows.map((row) => {
      const label = row.bet_type === "de" ? "Đề" : "Lô";
      return `• ${label} ${row.bet_number}: **${formatNumber(row.total)} ${CURRENCY_NAME}**`;
    });

    const { embed, totalPages, page } = buildLodeListEmbed(user.user_id, dayKey, lines, 0);
    const components = [];
    if (totalPages > 1) {
      components.push({
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "Trang trước",
            custom_id: `lode:prev:${user.user_id}:${page}:${dayKey}`,
            disabled: page === 0,
          },
          {
            type: 2,
            style: 2,
            label: "Trang sau",
            custom_id: `lode:next:${user.user_id}:${page}:${dayKey}`,
            disabled: page >= totalPages - 1,
          },
        ],
      });
    }

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: false,
    });
  }

  async function handleBetListButton(interaction, db, persist) {
    const customId = interaction.customId || "";
    const [prefix, action, ownerId, pageStr, dayKey] = customId.split(":");
    if (prefix !== "lode") return false;

    if (ownerId !== interaction.user.id) {
      await interaction.reply({
        embeds: [
          {
            color: 0xe74c3c,
            title: "Không thể dùng nút này",
            description: "Bạn không thể dùng nút này.",
            timestamp: new Date(),
          },
        ],
        ephemeral: true,
      });
      return true;
    }

    const targetDayKey = dayKey || getTargetBetDayKey();
    const rows = getUserBets(db, ownerId, targetDayKey);
    const lines = rows.map((row) => {
      const label = row.bet_type === "de" ? "Đề" : "Lô";
      return `• ${label} ${row.bet_number}: **${formatNumber(row.total)} ${CURRENCY_NAME}**`;
    });
    const currentPage = Number(pageStr || 0);
    const nextPage = action === "next" ? currentPage + 1 : currentPage - 1;
    const { embed, totalPages, page } = buildLodeListEmbed(ownerId, targetDayKey, lines, nextPage);
    const components = [];
    if (totalPages > 1) {
      components.push({
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "Trang trước",
            custom_id: `lode:prev:${ownerId}:${page}:${targetDayKey}`,
            disabled: page === 0,
          },
          {
            type: 2,
            style: 2,
            label: "Trang sau",
            custom_id: `lode:next:${ownerId}:${page}:${targetDayKey}`,
            disabled: page >= totalPages - 1,
          },
        ],
      });
    }

    await interaction.update({
      embeds: [embed],
      components,
    });
    return true;
  }

  async function processResults() {
    const client = clientRefGetter?.();
    if (!client || !KQXS_CHANNEL_ID) return;

    let text;
    try {
      const response = await fetch(RESULT_URL);
      text = await response.text();
    } catch (error) {
      const channel = await client.channels.fetch(KQXS_CHANNEL_ID);
      if (channel) {
        await channel.send({
          embeds: [
            {
              color: 0xe74c3c,
              title: "Lỗi lấy kết quả KQXS",
              description: error?.message || String(error),
              timestamp: new Date(),
            },
          ],
        });
      }
      return;
    }

    const resultDayKey = parseResultDateKey(text);
    if (!resultDayKey) return;
    const todayKey = getVietnamDayKey();

    if (resultDayKey !== todayKey) {
      const channel = await client.channels.fetch(KQXS_CHANNEL_ID);
      if (channel) {
        await channel.send({
          embeds: [
            {
              color: 0xf1c40f,
              title: "Không có kết quả hôm nay",
              description: `Không tìm thấy kết quả cho ngày ${formatDayLabel(todayKey)}.`,
              timestamp: new Date(),
            },
          ],
        });
      }
      return;
    }

    const { dbNumber, last2, lines } = parseResults(text);
    if (!dbNumber) return;
    const dbLast2 = dbNumber.slice(-2).padStart(2, "0");
    const resultLines = [
      `Giải ĐB: **${dbNumber}** (2 số cuối: **${dbLast2}**)`,
      `Tổng số lượt về: **${last2.length}**`,
    ];

    await withDatabase(async (db, persist) => {
      const lastProcessed = getLastDayProcessed(db);
      if (lastProcessed === resultDayKey) return;

      const bets = getAllBets(db, resultDayKey);
      const winningsByUser = new Map();

      const hitCounts = last2.reduce((acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
      }, {});

      db.run("BEGIN");
      for (const bet of bets) {
        const betNumber = String(bet.bet_number);
        const amount = Number(bet.total || 0);
        if (amount <= 0) continue;
        let payout = 0;
        if (bet.bet_type === "de" && betNumber === dbLast2) {
          payout = Math.floor(amount * 70);
        } else if (bet.bet_type === "lo" && hitCounts[betNumber]) {
          payout = Math.floor(amount * 3.5 * hitCounts[betNumber]);
        }

        if (payout > 0) {
          db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [
            payout,
            bet.user_id,
          ]);
          const current = winningsByUser.get(bet.user_id) || 0;
          winningsByUser.set(bet.user_id, current + payout);
        }
      }

      db.run("DELETE FROM lode_bets WHERE day_key = ?", [resultDayKey]);
      setLastDayProcessed(db, resultDayKey);
      db.run("COMMIT");
      persist();

      const winnerLines = Array.from(winningsByUser.entries()).map(
        ([userId, total]) => `• <@${userId}> nhận **${formatNumber(total)} ${CURRENCY_NAME}**`
      );

      const channel = await client.channels.fetch(KQXS_CHANNEL_ID);
      if (channel) {
        const embeds = buildResultEmbeds(resultDayKey, resultLines, winnerLines);
        for (const embed of embeds) {
          await channel.send({ embeds: [embed] });
        }
      }
    });
  }

  const startScheduler = () => {
    scheduleDaily(processResults);
  };

  return {
    handleDanhDe: (interaction, db, persist) => handleDanh(interaction, db, persist, "de"),
    handleDanhLo: (interaction, db, persist) => handleDanh(interaction, db, persist, "lo"),
    handleLode,
    handleBetListButton,
    startScheduler,
  };
}

module.exports = createKqxsService;
