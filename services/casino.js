const ROUND_STATUS = {
  ACTIVE: "active",
  NONE: "none",
};

function createCasinoService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  CASINO_CHANNEL_ID,
  CASINO_ROLE_ID,
  ADMIN_ROLE_ID,
  ADMIN_CHANNEL_ID,
  CASINO_OWNER_DURATION_MS,
  CASINO_COMMISSION_RATE,
  clientRefGetter,
}) {
  let expirationTimer = null;

  const getState = (db) => {
    const stmt = db.prepare(
      "SELECT owner_id, min_balance, max_chanle, started_at FROM casino_state WHERE id = 1"
    );
    const has = stmt.step();
    const row = has ? stmt.getAsObject() : null;
    stmt.free();
    return {
      ownerId: row?.owner_id || null,
      minBalance: row?.min_balance ? Number(row.min_balance) : 10000000,
      maxChanLe: row?.max_chanle ? Number(row.max_chanle) : null,
      startedAt: row?.started_at ? Number(row.started_at) : null,
    };
  };

  const updateState = (db, persist, updates) => {
    const current = getState(db);
    const next = {...current, ...updates};
    db.run(
      "UPDATE casino_state SET owner_id = ?, min_balance = ?, max_chanle = ?, started_at = ? WHERE id = 1",
      [next.ownerId, next.minBalance, next.maxChanLe, next.startedAt]
    );
    persist();
    return next;
  };

  const setExpirationTimer = () => {
    clearTimeout(expirationTimer);
    if (!CASINO_OWNER_DURATION_MS) return;
    expirationTimer = setTimeout(checkExpiration, 60 * 1000);
  };

  const checkExpiration = async () => {
    await withDatabase(async (db, persist) => {
      const state = getState(db);
      if (!state.ownerId || !state.startedAt) return;
      const now = Date.now();
      if (now - state.startedAt >= CASINO_OWNER_DURATION_MS) {
        await releaseOwner("expired", db, persist);
      }
    });
    setExpirationTimer();
  };

  const ensureMemberHasRole = async (guild, userId) => {
    if (!CASINO_ROLE_ID) return;
    try {
      const member = await guild.members.fetch(userId);
      if (!member.roles.cache.has(CASINO_ROLE_ID)) {
        await member.roles.add(CASINO_ROLE_ID);
      }
    } catch (error) {
      console.error("Không thêm role Chủ Sòng Bài được:", error);
    }
  };

  const removeRole = async (guild, userId) => {
    if (!CASINO_ROLE_ID) return;
    try {
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(CASINO_ROLE_ID)) {
        await member.roles.remove(CASINO_ROLE_ID);
      }
    } catch (error) {
      console.error("Không xóa role Chủ Sòng Bài được:", error);
    }
  };

  const announce = async (content) => {
    if (!CASINO_CHANNEL_ID) return;
    const client = clientRefGetter();
    if (!client) return;
    try {
      const channel = await client.channels.fetch(CASINO_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        await channel.send(content);
      }
    } catch (error) {
      console.error("Không gửi thông báo sòng bài:", error);
    }
  };

  const releaseOwner = async (reason, db, persist) => {
    const state = getState(db);
    if (!state.ownerId) return state;
    const client = clientRefGetter();
    const guild = client?.guilds?.cache?.first();
    if (guild) {
      await removeRole(guild, state.ownerId);
    }
    const msg =
      reason === "expired"
        ? TEXT.casinoExpired
        : reason === "bankrupt"
          ? TEXT.casinoBankrupt
          : TEXT.casinoReleased;
    await announce(msg);
    return updateState(db, persist, {ownerId: null, startedAt: null});
  };

  const handleNpc = async (interaction, db, persist) => {
    if (CASINO_CHANNEL_ID && interaction.channelId !== CASINO_CHANNEL_ID) {
      await interaction.reply({content: TEXT.casinoChannelOnly, ephemeral: true});
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

    const state = getState(db);
    if (state.ownerId) {
      await interaction.reply({content: TEXT.casinoAlreadyOwner, ephemeral: true});
      return;
    }

    if (Number(user.currency || 0) < state.minBalance) {
      await interaction.reply({content: TEXT.casinoBelowMin, ephemeral: true});
      return;
    }

    const autoMax = Math.floor(Number(user.currency || 0) * 0.2);
    updateState(db, persist, {ownerId: user.user_id, startedAt: Date.now(), maxChanLe: autoMax});
    await ensureMemberHasRole(interaction.guild, user.user_id);
    setExpirationTimer();

    await interaction.reply({
      content: `${TEXT.casinoClaimed} Chủ Sòng: <@${user.user_id}>`,
      ephemeral: false,
    });
  };

  const handleHuyNpc = async (interaction, db, persist) => {
    if (CASINO_CHANNEL_ID && interaction.channelId !== CASINO_CHANNEL_ID) {
      await interaction.reply({content: TEXT.casinoChannelOnly, ephemeral: true});
      return;
    }

    const state = getState(db);
    if (!state.ownerId || state.ownerId !== interaction.user.id) {
      await interaction.reply({content: TEXT.casinoNotOwner, ephemeral: true});
      return;
    }

    await releaseOwner("manual", db, persist);
    await interaction.reply({content: TEXT.casinoReleased, ephemeral: false});
  };

  const handleSetMaxChanLe = async (interaction, db, persist) => {
    if (CASINO_CHANNEL_ID && interaction.channelId !== CASINO_CHANNEL_ID) {
      await interaction.reply({content: TEXT.casinoChannelOnly, ephemeral: true});
      return;
    }

    const state = getState(db);
    if (!state.ownerId || state.ownerId !== interaction.user.id) {
      await interaction.reply({content: TEXT.casinoOwnerRequired, ephemeral: true});
      return;
    }

    const amount = Number(interaction.options.getInteger("nganluong", true));
    const owner = getUser(db, state.ownerId);
    const balance = Number(owner?.currency || 0);
    const minAllowed = Math.floor(balance * 0.2);
    const maxAllowed = Math.floor(balance * 0.5);
    if (amount < minAllowed || amount > maxAllowed) {
      await interaction.reply({content: `Giới hạn: ${formatNumber(minAllowed)} - ${formatNumber(maxAllowed)} ${CURRENCY_NAME} (20%-50% tài sản).`, ephemeral: true});
      return;
    }

    updateState(db, persist, {maxChanLe: amount});
    await interaction.reply({
      content: `${TEXT.casinoMaxSet} ${formatNumber(amount)} ${CURRENCY_NAME}.`,
      ephemeral: false,
    });
  };

  const handleSetMinBalance = async (interaction, db, persist) => {
    if (ADMIN_CHANNEL_ID && interaction.channelId !== ADMIN_CHANNEL_ID) {
      await interaction.reply({content: TEXT.backupChannelOnly, ephemeral: true});
      return;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (ADMIN_ROLE_ID && !member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({content: "Bạn không có quyền.", ephemeral: true});
      return;
    }

    const amount = Number(interaction.options.getInteger("nganluong", true));
    if (amount <= 0) {
      await interaction.reply({content: "Số phải lớn hơn 0.", ephemeral: true});
      return;
    }

    updateState(db, persist, {minBalance: amount});
    await interaction.reply({
      content: `${TEXT.casinoMinSet} ${formatNumber(amount)} ${CURRENCY_NAME}.`,
      ephemeral: false,
    });
  };

  const applyChanLeSettlement = (db, persist, {playerId, betAmount, payout, isWin}) => {
    const state = getState(db);
    if (!state.ownerId) return {ownerId: null};

    const commission = Math.floor(betAmount * CASINO_COMMISSION_RATE);
    const owner = getUser(db, state.ownerId);
    if (!owner) return {ownerId: null};

    const houseGain = betAmount + commission - (isWin ? payout : 0);
    const newBalance = Number(owner.currency || 0) + houseGain;
    if (newBalance < 0) {
      return {ownerId: null, insufficient: true};
    }

    db.run("BEGIN");
    db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [commission + betAmount, state.ownerId]);
    if (isWin) {
      db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [payout, state.ownerId]);
    }
    db.run("COMMIT");
    persist();

    const refreshed = getUser(db, state.ownerId);
    let released = false;
    if (refreshed && refreshed.currency < state.minBalance) {
      released = true;
    }

    return {
      ownerId: state.ownerId,
      commission,
      released,
      ownerBalance: refreshed?.currency || newBalance,
    };
  };

  const ensureOwnerStillValid = async (interaction, db, persist) => {
    const state = getState(db);
    if (!state.ownerId) return state;
    const owner = getUser(db, state.ownerId);
    if (!owner || owner.currency < state.minBalance) {
      await releaseOwner("bankrupt", db, persist);
      return getState(db);
    }
    const guild = interaction.guild;
    await ensureMemberHasRole(guild, state.ownerId);
    return state;
  };

  const init = () => {
    setExpirationTimer();
  };

  return {
    init,
    getState,
    handleNpc,
    handleHuyNpc,
    handleSetMaxChanLe,
    handleSetMinBalance,
    applyChanLeSettlement,
    ensureOwnerStillValid,
  };
}

module.exports = createCasinoService;
