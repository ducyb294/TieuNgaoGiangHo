const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const START_DELAY_MS = 10_000;
const TURN_SOFT_MS = 10_000;
const TURN_HARD_MS = 15_000;
const AUTO_DELETE_MS = 30 * 60 * 1000;

function createBlackjackService({
  withDatabase,
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
  TEXT,
  BLACKJACK_CHANNEL_ID,
  defaultBet = 0,
  clientRefGetter,
}) {
  const tables = new Map();
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["♠", "♥", "♦", "♣"];

  const getClient = () => (clientRefGetter ? clientRefGetter() : null);

  const getChannel = async () => {
    if (!BLACKJACK_CHANNEL_ID) return null;
    const client = getClient();
    if (!client) return null;
    const cached = client.channels.cache.get(BLACKJACK_CHANNEL_ID);
    if (cached) return cached;
    try {
      return await client.channels.fetch(BLACKJACK_CHANNEL_ID);
    } catch (error) {
      console.error("Không lấy được channel blackjack:", error);
      return null;
    }
  };

  const getThread = async (threadId) => {
    if (!threadId) return null;
    const client = getClient();
    if (!client) return null;
    const cached = client.channels.cache.get(threadId);
    if (cached) return cached;
    try {
      return await client.channels.fetch(threadId);
    } catch (error) {
      return null;
    }
  };

  const buildDeck = () => {
    const deck = [];
    for (const suit of suits) {
      for (const rank of ranks) deck.push({ rank, suit });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  };

  const drawCard = (deck) => deck.pop();
  const cardToString = (card) => `${card.rank}${card.suit}`;

  const handValue = (hand) => {
    let total = 0;
    let aces = 0;
    for (const card of hand.cards) {
      if (card.rank === "A") {
        total += 11;
        aces += 1;
      } else if (["K", "Q", "J"].includes(card.rank)) {
        total += 10;
      } else {
        total += Number(card.rank);
      }
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  };

  const formatHand = (hand) => `${hand.cards.map(cardToString).join(", ")} (${handValue(hand)})`;

  const buildJoinRow = (threadId, disabled = false) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_join:${threadId}`)
        .setLabel("Tham gia")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );

  const rankValue = (card) => (["J", "Q", "K"].includes(card.rank) ? "10" : card.rank);

  const buildActionRow = (table) => {
    const current = getCurrentPlayer(table);
    const threadId = table.threadId;
    const canAct = table.state === "playing" && current && !current.hand.finished && !current.hand.busted;
    const canDouble = canAct && current.hand.cards.length === 2 && !current.hand.doubled;
    const canSplit =
      canAct &&
      current.hand.cards.length === 2 &&
      rankValue(current.hand.cards[0]) === rankValue(current.hand.cards[1]) &&
      current.player.hands.length < 4;

    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_action:hit:${threadId}`)
        .setLabel("Rút bài")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canAct),
      new ButtonBuilder()
        .setCustomId(`bj_action:stand:${threadId}`)
        .setLabel("Dừng")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canAct),
      new ButtonBuilder()
        .setCustomId(`bj_action:double:${threadId}`)
        .setLabel("Gấp đôi")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canDouble),
      new ButtonBuilder()
        .setCustomId(`bj_action:split:${threadId}`)
        .setLabel("Chia")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canSplit)
    );
  };

  const touch = (table) => {
    table.lastActivity = Date.now();
    scheduleCleanup(table);
  };

  const clearCountdownTimers = (table) => {
    if (table.countdownTimeout) clearTimeout(table.countdownTimeout);
    if (table.countdownInterval) clearInterval(table.countdownInterval);
    table.countdownTimeout = null;
    table.countdownInterval = null;
    table.countdownEndsAt = null;
  };

  const clearTurnTimers = (table) => {
    if (table.turnTimeout) clearTimeout(table.turnTimeout);
    if (table.turnInterval) clearInterval(table.turnInterval);
    table.turnTimeout = null;
    table.turnInterval = null;
    table.turnDeadline = null;
  };

  const startTurnTimers = (table) => {
    clearTurnTimers(table);
    table.turnDeadline = Date.now() + TURN_HARD_MS;
    table.turnTimeout = setTimeout(() => handleAutoStand(table.threadId), TURN_HARD_MS);
    table.turnInterval = setInterval(() => updateStateMessage(table), 1000);
  };

  const scheduleCleanup = (table) => {
    if (table.cleanupTimeout) clearTimeout(table.cleanupTimeout);
    table.cleanupTimeout = setTimeout(() => cleanupTable(table.threadId), AUTO_DELETE_MS);
  };

  const cleanupTable = async (tableId) => {
    const table = tables.get(tableId);
    if (!table) return;
    clearCountdownTimers(table);
    clearTurnTimers(table);
    if (table.cleanupTimeout) clearTimeout(table.cleanupTimeout);
    tables.delete(tableId);
    const thread = await getThread(tableId);
    if (thread) {
      try {
        await thread.send("Bàn bị xóa do không hoạt động 30 phút.");
      } catch (_) {}
      try {
        await thread.delete();
      } catch (error) {
        console.error("Không thể xóa thread blackjack:", error);
      }
    }
  };

  const buildStateEmbed = (table, opts = {}) => {
    const now = Date.now();
    const isPlaying = table.state === "playing";
    const currentPlayer = getCurrentPlayer(table);
    const timeLeft =
      isPlaying && table.turnDeadline ? Math.max(0, Math.ceil((table.turnDeadline - now) / 1000)) : null;

    let dealerText = "Chưa chia.";
    if (table.dealerHand.length > 0) {
      if (table.roundFinished) {
        dealerText = formatHand({ cards: table.dealerHand });
      } else {
        dealerText = `${cardToString(table.dealerHand[0])} + [?]`;
      }
    }

    const playerLines =
      table.players.length === 0
        ? "Chưa có người chơi."
        : table.players
            .map((p, pIdx) => {
              const isCurrentPlayer = isPlaying && currentPlayer && currentPlayer.player.id === p.id;
              const arrow = isCurrentPlayer ? "-> " : "";
              const handsText =
                p.hands && p.hands.length > 0
                  ? p.hands
                      .map((h, hIdx) => {
                        const status = h.busted
                          ? "BUST"
                          : h.finished
                          ? "Đứng"
                          : "Đang chơi";
                        const handMarker =
                          isCurrentPlayer && currentPlayer.handIndex === hIdx ? " (dang choi)" : "";
                        return `Hand ${hIdx + 1}${handMarker}: ${formatHand(h)} [${status}${h.doubled ? ", x2" : ""}]`;
                      })
                      .join(" | ")
                  : "Chưa chia.";
              return `${arrow}${pIdx + 1}. <@${p.id}> - ${handsText}`;
            })
            .join("\n");
    const description =
      table.state === "waiting"
        ? "Nhấn Tham gia để vào bàn. Khi có người sẽ đếm ngược 10s."
        : table.state === "countdown"
        ? "Sắp bắt đầu, người mới tham gia sẽ reset thời gian."
        : table.state === "playing"
        ? `Đang chơi. Lượt hiện tại: ${currentPlayer ? `<@${currentPlayer.player.id}> (hand ${currentPlayer.handIndex + 1})` : "N/A"}.`
        : "Đang chuẩn bị.";

    const fields = [
      { name: "Tiền cược", value: `${formatNumber(table.betAmount)} ${CURRENCY_NAME}`, inline: true },
      { name: "Dealer", value: dealerText, inline: true },
      { name: "Người chơi", value: playerLines },
    ];

    if (table.state === "countdown" && table.countdownEndsAt) {
      const left = Math.max(0, Math.ceil((table.countdownEndsAt - now) / 1000));
      fields.push({ name: "Bắt đầu sau", value: `${left}s`, inline: true });
    }

    if (isPlaying && timeLeft !== null) {
      fields.push({ name: "Thời gian còn", value: `${timeLeft}s`, inline: true });
    }

    return {
      color: opts.color || (table.state === "playing" ? 0x3498db : 0x2ecc71),
      title: `Bàn Blackjack (${formatNumber(table.betAmount)} ${CURRENCY_NAME})`,
      description,
      fields,
      timestamp: new Date().toISOString(),
    };
  };

  const postStateMessage = async (table, components) => {
    const thread = await getThread(table.threadId);
    if (!thread) return;
    const message = await thread.send({
      embeds: [buildStateEmbed(table)],
      components: components || [],
    });
    table.stateMessageId = message.id;
    return message;
  };

  const updateStateMessage = async (table) => {
    const thread = await getThread(table.threadId);
    if (!thread) return;
    const components = buildComponents(table);
    try {
      if (table.stateMessageId) {
        const msg = await thread.messages.fetch(table.stateMessageId);
        await msg.edit({
          embeds: [buildStateEmbed(table)],
          components,
        });
        return;
      }
    } catch (_) {
      // fallthrough to sending new message
    }
    await postStateMessage(table, components);
  };

  const buildComponents = (table) => {
    if (table.state === "waiting" || table.state === "countdown") {
      return [buildJoinRow(table.threadId)];
    }
    if (table.state === "playing") {
      return [buildActionRow(table)];
    }
    return [];
  };

  const ensureTable = async ({ channel, betAmount, creatorId, interaction, note }) => {
    const baseMessage = interaction
      ? await interaction.editReply({
          content: `Đang tạo bàn cược **${formatNumber(betAmount)} ${CURRENCY_NAME}**...`,
        })
      : await channel.send({
          content: `Đang tạo bàn blackjack cược **${formatNumber(betAmount)} ${CURRENCY_NAME}**...`,
        });

    const threadName = `Blackjack ${formatNumber(betAmount)} - ${creatorId || "auto"}`.slice(0, 90);
    const thread = await baseMessage.startThread({
      name: threadName,
      autoArchiveDuration: 1440,
    });

    const table = {
      id: thread.id,
      threadId: thread.id,
      channelId: thread.parentId || channel?.id || null,
      betAmount,
      state: "waiting",
      players: [],
      deck: [],
      dealerHand: [],
      currentPlayerIndex: -1,
      currentHandIndex: 0,
      countdownTimeout: null,
      countdownEndsAt: null,
      countdownInterval: null,
      turnTimeout: null,
      turnInterval: null,
      turnDeadline: null,
      stateMessageId: null,
      roundFinished: false,
      lastActivity: Date.now(),
      cleanupTimeout: null,
    };
    tables.set(thread.id, table);
    scheduleCleanup(table);

    await postStateMessage(table, [buildJoinRow(thread.id)]);

    await baseMessage.edit({
      content: "",
      embeds: [
        {
          color: 0x2ecc71,
          title: "Đã tạo bàn Blackjack",
          description:
            `Thread: <#${thread.id}>\n` +
            `Cược mỗi người: **${formatNumber(betAmount)} ${CURRENCY_NAME}**\n` +
            "Nhấn Tham gia trong thread để vào bàn. Ván sẽ tự chạy khi có người.",
        },
      ],
    });

    if (note) {
      await thread.send(note);
    }

    return table;
  };

  const startCountdown = async (table) => {
    clearCountdownTimers(table);
    table.state = "countdown";
    table.countdownEndsAt = Date.now() + START_DELAY_MS;
    table.countdownTimeout = setTimeout(() => startRound(table.threadId), START_DELAY_MS);
    table.countdownInterval = setInterval(() => updateStateMessage(table), 1000);
    touch(table);
    await updateStateMessage(table);
  };

  const startRound = async (tableId) => {
    const table = tables.get(tableId);
    if (!table || table.state === "playing") return;
    clearCountdownTimers(table);
    clearTurnTimers(table);
    table.roundFinished = false;
    table.deck = buildDeck();
    table.dealerHand = [drawCard(table.deck), drawCard(table.deck)];
    table.currentPlayerIndex = 0;
    table.currentHandIndex = 0;
    table.state = "playing";

    // Deduct base bet for all players and validate balance
    const activePlayers = [];
    await withDatabase(async (db, persist) => {
      let changed = false;
      for (const p of table.players) {
        let user = getUser(db, p.id);
        if (!user) {
          user = createUser(db, persist, p.id, p.name || "Khach", Date.now());
        }
        user = applyPassiveExpForUser(db, persist, user);
        const current = Number(user.currency || 0);
        if (current < table.betAmount) {
          const thread = await getThread(table.threadId);
          if (thread) {
            await thread.send(`<@${p.id}> không đủ ${formatNumber(table.betAmount)} ${CURRENCY_NAME}, bỏ qua ván này.`);
          }
          continue;
        }
        db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [table.betAmount, p.id]);
        changed = true;
        activePlayers.push({ ...p });
      }
      if (changed) persist();
    });

    table.players = activePlayers.map((p) => ({
      ...p,
      hands: [{ cards: [drawCard(table.deck), drawCard(table.deck)], bet: table.betAmount, doubled: false, busted: false, finished: false }],
    }));

    if (table.players.length === 0) {
      table.state = "waiting";
      table.dealerHand = [];
      await updateStateMessage(table);
      touch(table);
      return;
    }

    await updateStateMessage(table);
    touch(table);
    await beginTurn(table);
  };

  const getCurrentPlayer = (table) => {
    if (table.currentPlayerIndex < 0 || table.currentPlayerIndex >= table.players.length) return null;
    const player = table.players[table.currentPlayerIndex];
    if (!player) return null;
    const hand = player.hands[table.currentHandIndex];
    if (!hand) return null;
    return { player, hand, handIndex: table.currentHandIndex };
  };

  const beginTurn = async (table) => {
    clearTurnTimers(table);
    let found = advanceToNextPlayableHand(table);
    if (!found) {
      await finishRound(table);
      return;
    }
    startTurnTimers(table);
    await updateStateMessage(table);
  };

  const advanceToNextPlayableHand = (table) => {
    for (let pIdx = table.currentPlayerIndex; pIdx < table.players.length; pIdx++) {
      const player = table.players[pIdx];
      for (let hIdx = pIdx === table.currentPlayerIndex ? table.currentHandIndex : 0; hIdx < player.hands.length; hIdx++) {
        const hand = player.hands[hIdx];
        if (!hand.finished && !hand.busted) {
          table.currentPlayerIndex = pIdx;
          table.currentHandIndex = hIdx;
          return true;
        }
      }
    }
    return false;
  };

  const handleAutoStand = async (tableId) => {
    const table = tables.get(tableId);
    if (!table || table.state !== "playing") return;
    const current = getCurrentPlayer(table);
    if (!current) return;
    await applyAction(table, current.player.id, "stand", true);
  };

  const applyAction = async (table, userId, action, isAuto = false) => {
    const current = getCurrentPlayer(table);
    if (!current || current.player.id !== userId) return { error: "not_turn" };
    const hand = current.hand;
    touch(table);

    const thread = await getThread(table.threadId);

    if (action === "hit") {
      hand.cards.push(drawCard(table.deck));
      const value = handValue(hand);
      if (value > 21) {
        hand.busted = true;
        hand.finished = true;
        await nextHand(table);
        return { ok: true };
      }
      startTurnTimers(table);
      await updateStateMessage(table);
      return { ok: true };
    }

    if (action === "stand") {
      hand.finished = true;
      await nextHand(table);
      return { ok: true };
    }

    if (action === "double") {
      if (hand.cards.length !== 2 || hand.doubled) {
        return { error: "invalid_double" };
      }
      const extraBet = hand.bet;
      const can = await deductForPlayer(userId, extraBet);
      if (!can) return { error: "not_enough" };
      hand.bet += extraBet;
      hand.doubled = true;
      hand.cards.push(drawCard(table.deck));
      const value = handValue(hand);
      hand.finished = true;
      if (value > 21) {
        hand.busted = true;
      }
      await nextHand(table);
      return { ok: true };
    }

    if (action === "split") {
      if (hand.cards.length !== 2 || hand.finished || hand.busted || current.player.hands.length >= 4) {
        return { error: "invalid_split" };
      }
      const [c1, c2] = hand.cards;
      if (rankValue(c1) !== rankValue(c2)) {
        return { error: "invalid_split" };
      }
      const extraBet = hand.bet;
      const can = await deductForPlayer(userId, extraBet);
      if (!can) return { error: "not_enough" };
      const newHands = [
        { cards: [c1, drawCard(table.deck)], bet: hand.bet, doubled: false, busted: false, finished: false },
        { cards: [c2, drawCard(table.deck)], bet: hand.bet, doubled: false, busted: false, finished: false },
      ];
      current.player.hands.splice(table.currentHandIndex, 1, ...newHands);
      table.currentHandIndex = table.currentHandIndex;
      startTurnTimers(table);
      await updateStateMessage(table);
      return { ok: true };
    }

    return { error: "unknown" };
  };

  const deductForPlayer = async (userId, amount) => {
    let ok = false;
    await withDatabase(async (db, persist) => {
      let user = getUser(db, userId);
      if (!user) return;
      user = applyPassiveExpForUser(db, persist, user);
      const bal = Number(user.currency || 0);
      if (bal < amount) return;
      db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [amount, userId]);
      persist();
      ok = true;
    });
    return ok;
  };

  const nextHand = async (table) => {
    clearTurnTimers(table);
    table.currentHandIndex += 1;
    const player = table.players[table.currentPlayerIndex];
    if (player && table.currentHandIndex >= player.hands.length) {
      table.currentPlayerIndex += 1;
      table.currentHandIndex = 0;
    }
    await beginTurn(table);
  };

  const finishRound = async (table) => {
    clearTurnTimers(table);
    table.roundFinished = true;
    const thread = await getThread(table.threadId);

    let dealerValue = handValue({ cards: table.dealerHand });
    const anyAlive = table.players.some((p) => p.hands.some((h) => !h.busted));
    if (anyAlive) {
      while (dealerValue < 17) {
        table.dealerHand.push(drawCard(table.deck));
        dealerValue = handValue({ cards: table.dealerHand });
      }
    }

    const resultLines = [];
    await withDatabase(async (db, persist) => {
      let changed = false;
      for (const player of table.players) {
        for (const hand of player.hands) {
          const value = handValue(hand);
          let outcome = "lose";
          let payout = 0;
          if (value > 21) {
            outcome = "bust";
          } else if (dealerValue > 21 || value > dealerValue) {
            outcome = "win";
            payout = hand.bet * 2;
          } else if (value === dealerValue) {
            outcome = "push";
            payout = hand.bet;
          }
          if (payout > 0) {
            db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [payout, player.id]);
            changed = true;
          }
          const delta = payout - hand.bet;
          const outcomeText =
            outcome === "win"
              ? `Thắng (+${formatNumber(delta)} ${CURRENCY_NAME})`
              : outcome === "push"
              ? `Hòa (+0)`
              : "Thua (-)";
          resultLines.push(
            `<@${player.id}> - ${formatHand(hand)} -> ${outcomeText}${hand.doubled ? " (x2)" : ""}`
          );
        }
      }
      if (changed) persist();
    });

    await thread?.send({
      embeds: [
        {
          color: 0x9b59b6,
          title: "Kết quả ván blackjack",
          fields: [
            { name: "Dealer", value: formatHand({ cards: table.dealerHand }), inline: true },
            { name: "Người chơi", value: resultLines.join("\n") || "Không có người chơi hợp lệ." },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });

    await openNewRound(table);
  };

  const openNewRound = async (table) => {
    clearCountdownTimers(table);
    clearTurnTimers(table);
    table.state = "waiting";
    table.players = [];
    table.deck = [];
    table.dealerHand = [];
    table.currentPlayerIndex = -1;
    table.currentHandIndex = 0;
    table.roundFinished = false;
    touch(table);
    await postStateMessage(table, [buildJoinRow(table.threadId)]);
  };

  const handleJoin = async (interaction, db, persist, threadId) => {
    const table = tables.get(threadId);
    if (!table) {
      await interaction.reply({ content: "Bàn không còn tồn tại.", ephemeral: true });
      return true;
    }
    if (table.state === "playing") {
      await interaction.reply({ content: "Bàn đang chơi, đợi ván tiếp theo.", ephemeral: true });
      return true;
    }
    const thread = await getThread(table.threadId);
    if (!thread) {
      await interaction.reply({ content: "Không tìm thấy thread của bàn.", ephemeral: true });
      return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }
    user = applyPassiveExpForUser(db, persist, user);

    if (Number(user.currency || 0) < table.betAmount) {
      await interaction.reply({ content: TEXT.notEnoughCurrency, ephemeral: true });
      return true;
    }

    if (table.players.some((p) => p.id === user.user_id)) {
      await interaction.reply({ content: "Bạn đã trong bàn này.", ephemeral: true });
      return true;
    }

    table.players.push({
      id: user.user_id,
      name: user.base_name || getBaseNameFromMember(member),
      hands: [],
    });
    touch(table);
    await interaction.reply({
      content: `Đã tham gia bàn cược **${formatNumber(table.betAmount)} ${CURRENCY_NAME}**.`,
      ephemeral: true,
    });
    if (table.state === "countdown") {
      await thread.send("Có người mới tham gia, reset đếm ngược 10s.");
    }
    await startCountdown(table);
    return true;
  };

  const handleCommand = async (interaction, db, persist) => {
    if (BLACKJACK_CHANNEL_ID && interaction.channelId !== BLACKJACK_CHANNEL_ID) {
      await interaction.reply({ content: TEXT.blackjackChannelOnly, ephemeral: true });
      return;
    }

    const betAmount = Number(interaction.options.getInteger("cuoc", true));
    if (betAmount <= 0) {
      await interaction.reply({ content: "Tiền cược phải lớn hơn 0.", ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }
    user = applyPassiveExpForUser(db, persist, user);
    if (Number(user.currency || 0) < betAmount) {
      await interaction.reply({ content: TEXT.notEnoughCurrency, ephemeral: true });
      return;
    }

    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    const table = await ensureTable({
      channel: interaction.channel,
      betAmount,
      creatorId: interaction.user.id,
      interaction,
      note: "Nhấn Tham gia để vào bàn. Có người sẽ tự động đếm ngược 10s.",
    });

    await interaction.followUp({
      content: `Bàn blackjack đã tạo trong <#${table.threadId}>.`,
      ephemeral: true,
    });
  };

  const handleActionButton = async (interaction, action, threadId) => {
    const table = tables.get(threadId);
    if (!table || table.state !== "playing") {
      await interaction.reply({ content: "Bàn không sẵn sàng hoặc chưa tới lượt.", ephemeral: true });
      return true;
    }
    const current = getCurrentPlayer(table);
    if (!current || current.player.id !== interaction.user.id) {
      await interaction.reply({ content: "Chưa tới lượt bạn.", ephemeral: true });
      return true;
    }
    const result = await applyAction(table, interaction.user.id, action, false);
    if (result.error === "not_enough") {
      await interaction.reply({ content: TEXT.notEnoughCurrency, ephemeral: true });
      return true;
    }
    if (result.error) {
      await interaction.reply({ content: "Hành động không hợp lệ lúc này.", ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    return true;
  };

  const handleButton = async (interaction, db, persist) => {
    const customId = interaction.customId || "";
    if (customId.startsWith("bj_join:")) {
      const [, threadId] = customId.split(":");
      return await handleJoin(interaction, db, persist, threadId);
    }

    if (customId.startsWith("bj_action:")) {
      const [, action, threadId] = customId.split(":");
      return await handleActionButton(interaction, action, threadId);
    }

    return false;
  };

  const init = async () => {
    if (!BLACKJACK_CHANNEL_ID) return;
    if (!defaultBet || defaultBet <= 0) return;
    const channel = await getChannel();
    if (!channel) return;
    try {
      const baseMessage = await channel.send({
        content: `Tự động mở bàn blackjack cược **${formatNumber(defaultBet)} ${CURRENCY_NAME}**.`,
      });
      await ensureTable({
        channel,
        betAmount: defaultBet,
        creatorId: "auto",
        interaction: {
          editReply: (payload) => baseMessage.edit(payload),
        },
        note: "Bàn tự khởi động khi bot online.",
      });
    } catch (error) {
      console.error("Không thể tự động mở bàn blackjack:", error);
    }
  };

  return {
    handleCommand,
    handleButton,
    init,
  };
}

module.exports = createBlackjackService;
