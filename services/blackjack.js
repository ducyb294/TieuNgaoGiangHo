const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const START_DELAY_MS = 10_000;
const TURN_CHOICE_MS = 10_000;
const TURN_TIMEOUT_MS = 15_000;

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
  const pendingActions = new Map(); // threadId -> { playerId, resolve }

  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["♠", "♥", "♦", "♣"];

  const getClient = () => (clientRefGetter ? clientRefGetter() : null);

  const getThread = async (threadId) => {
    if (!threadId) return null;
    const client = getClient();
    if (!client) return null;
    const cached = client.channels.cache.get(threadId);
    if (cached) return cached;
    try {
      return await client.channels.fetch(threadId);
    } catch (error) {
      console.error("Không lấy được thread blackjack:", error);
      return null;
    }
  };

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

  const buildDeck = () => {
    const deck = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ rank, suit });
      }
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
    for (const card of hand) {
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

  const formatHand = (hand) => `${hand.map(cardToString).join(", ")} (${handValue(hand)})`;

  const buildJoinRow = (threadId, disabled = false) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_join:${threadId}`)
        .setLabel("Tham gia")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );

  const buildActionRow = (threadId, disabled = false) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_action:hit:${threadId}`)
        .setLabel("Rút bài")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`bj_action:stand:${threadId}`)
        .setLabel("Dừng")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );

  const buildLobbyEmbed = (table, statusText) => {
    const playersText =
      table.players.length > 0
        ? table.players.map((p, idx) => `${idx + 1}. <@${p.id}>`).join("\n")
        : "Chưa có ai.";
    const status =
      statusText ||
      (table.state === "playing"
        ? "Đang chơi, vui lòng đợi ván mới."
        : table.state === "countdown"
          ? "Chuẩn bị bắt đầu (~10s)."
          : "Nhấn Tham gia để vào bàn.");

    return {
      color: 0x3498db,
      title: `Bàn Blackjack (${formatNumber(table.betAmount)} ${CURRENCY_NAME})`,
      description: status,
      fields: [
        {
          name: "Người chơi",
          value: playersText,
        },
        {
          name: "Thread",
          value: `<#${table.threadId}>`,
          inline: true,
        },
        {
          name: "Trạng thái",
          value: table.state,
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  };

  const refreshLobbyMessage = async (table, statusText, disableJoin = table.state === "playing") => {
    if (!table.lobbyMessageId) return;
    const thread = await getThread(table.threadId);
    if (!thread) return;
    try {
      const lobbyMessage = await thread.messages.fetch(table.lobbyMessageId);
      await lobbyMessage.edit({
        embeds: [buildLobbyEmbed(table, statusText)],
        components: [buildJoinRow(table.threadId, disableJoin || table.state === "playing")],
      });
    } catch (error) {
      console.error("Không cập nhật được lobby blackjack:", error);
    }
  };

  const clearCountdown = (table) => {
    if (table.countdownTimeout) {
      clearTimeout(table.countdownTimeout);
      table.countdownTimeout = null;
    }
    table.countdownEndsAt = null;
  };

  const resetTable = async (table, thread, statusText) => {
    clearCountdown(table);
    table.players = [];
    table.state = "waiting";
    await refreshLobbyMessage(table, statusText || "Bàn mới đã sẵn sàng.");
    if (thread) {
      await thread.send("Đã mở ván mới, nhấn **Tham gia** để vào bàn.");
    }
  };

  const createTable = async ({ channel, betAmount, creatorId, interaction, note }) => {
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
      creatorId,
      anchorMessageId: baseMessage.id,
      lobbyMessageId: null,
      players: [],
      state: "waiting",
      countdownTimeout: null,
      countdownEndsAt: null,
    };
    tables.set(thread.id, table);

    const lobbyMessage = await thread.send({
      embeds: [buildLobbyEmbed(table, note || "Nhấn Tham gia để vào bàn. Bắt đầu khi có ít nhất 1 người.")],
      components: [buildJoinRow(thread.id)],
    });
    table.lobbyMessageId = lobbyMessage.id;

    const summaryEmbed = {
      color: 0x2ecc71,
      title: "Đã tạo bàn Blackjack",
      description:
        `Thread: <#${thread.id}>\n` +
        `Cược mỗi người: **${formatNumber(betAmount)} ${CURRENCY_NAME}**\n` +
        "Nút tham gia nằm trong thread, ván sẽ tự khởi động sau khi có người chơi.",
      timestamp: new Date().toISOString(),
    };

    await baseMessage.edit({
      content: "",
      embeds: [summaryEmbed],
      components: [],
    });

    return table;
  };

  const waitForAction = (threadId, playerId) =>
    new Promise((resolve) => {
      const finish = (result) => {
        const pending = pendingActions.get(threadId);
        if (pending && pending.resolve === finish) {
          pendingActions.delete(threadId);
        }
        clearTimeout(shortTimer);
        clearTimeout(longTimer);
        resolve(result);
      };
      const shortTimer = setTimeout(() => finish("timeout"), TURN_CHOICE_MS);
      const longTimer = setTimeout(() => finish("timeout"), TURN_TIMEOUT_MS);
      pendingActions.set(threadId, { playerId, resolve: finish });
    });

  const playPlayerTurn = async ({ table, thread, player, hand, dealerUpCard, deck }) => {
    let value = handValue(hand);
    let promptMessage = await thread.send({
      content: `<@${player.id}> đến lượt bạn (10s).`,
      embeds: [
        {
          color: 0x1abc9c,
          title: `Lượt của ${player.name}`,
          description: `Bài của bạn: **${formatHand(hand)}**\nDealer: **${cardToString(dealerUpCard)} + [?]**`,
          footer: { text: "Hết giờ sẽ tự động Dừng." },
          timestamp: new Date().toISOString(),
        },
      ],
      components: value >= 21 ? [buildActionRow(table.threadId, true)] : [buildActionRow(table.threadId)],
    });

    while (value < 21) {
      const action = await waitForAction(table.threadId, player.id);
      if (action === "hit") {
        hand.push(drawCard(deck));
        value = handValue(hand);
        await promptMessage.edit({
          content: `<@${player.id}> đã chọn Rút bài.`,
          embeds: [
            {
              color: value > 21 ? 0xe74c3c : 0x1abc9c,
              title: `Lượt của ${player.name}`,
              description: `Bài của bạn: **${formatHand(hand)}**\nDealer: **${cardToString(dealerUpCard)} + [?]**`,
              footer: { text: "Hết giờ sẽ tự động Dừng." },
              timestamp: new Date().toISOString(),
            },
          ],
          components: value >= 21 ? [buildActionRow(table.threadId, true)] : [buildActionRow(table.threadId)],
        });
        if (value >= 21) break;
      } else {
        await thread.send(`<@${player.id}> hết thời gian hoặc chọn Dừng.`);
        break;
      }
    }

    await promptMessage.edit({
      components: [buildActionRow(table.threadId, true)],
    });

    return { player, hand: [...hand], value: handValue(hand) };
  };

  const startRound = async (tableId) => {
    const table = tables.get(tableId);
    if (!table) return;
    clearCountdown(table);
    if (table.state === "playing") return;
    if (table.players.length === 0) {
      table.state = "waiting";
      await refreshLobbyMessage(table, "Chưa có người tham gia, bàn vẫn mở.");
      return;
    }

    table.state = "playing";
    await refreshLobbyMessage(table, "Đang chia bài...", true);

    const thread = await getThread(table.threadId);
    if (!thread) {
      tables.delete(tableId);
      return;
    }

    const deck = buildDeck();
    const dealerHand = [drawCard(deck), drawCard(deck)];

    const initialPlayers = [...table.players];
    const activePlayers = [];

    await withDatabase(async (db, persist) => {
      let hasChange = false;
      for (const player of initialPlayers) {
        let user = getUser(db, player.id);
        if (!user) {
          user = createUser(
            db,
            persist,
            player.id,
            player.name || `Khach`,
            Date.now()
          );
        }
        user = applyPassiveExpForUser(db, persist, user);
        if (Number(user.currency || 0) < table.betAmount) {
          await thread.send(
            `<@${player.id}> không đủ **${formatNumber(table.betAmount)} ${CURRENCY_NAME}** cho ván này, sẽ bị bỏ qua.`
          );
          continue;
        }
        db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [table.betAmount, player.id]);
        hasChange = true;
        activePlayers.push({ ...player });
      }
      if (hasChange) {
        persist();
      }
    });

    table.players = activePlayers;

    if (activePlayers.length === 0) {
      table.state = "waiting";
      await refreshLobbyMessage(table, "Không ai đủ tiền, bàn mở lại.");
      return;
    }

    const playerHands = new Map();
    for (const player of activePlayers) {
      playerHands.set(player.id, [drawCard(deck), drawCard(deck)]);
    }

    await thread.send({
      embeds: [
        {
          color: 0x2980b9,
          title: "Bắt đầu ván blackjack",
          description: `Cược mỗi người: **${formatNumber(table.betAmount)} ${CURRENCY_NAME}**`,
          fields: [
            { name: "Dealer", value: `${cardToString(dealerHand[0])} + [?]` },
            {
              name: "Người chơi",
              value: activePlayers.map((p) => `<@${p.id}>`).join("\n"),
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const playerResults = [];
    for (const player of activePlayers) {
      const result = await playPlayerTurn({
        table,
        thread,
        player,
        hand: playerHands.get(player.id),
        dealerUpCard: dealerHand[0],
        deck,
      });
      playerHands.set(player.id, result.hand);
      playerResults.push(result);
    }

    let dealerValue = handValue(dealerHand);
    if (playerResults.some((r) => r.value <= 21)) {
      while (dealerValue < 17) {
        dealerHand.push(drawCard(deck));
        dealerValue = handValue(dealerHand);
      }
    }

    const settlements = [];

    await withDatabase(async (db, persist) => {
      let hasChange = false;
      for (const result of playerResults) {
        const playerValue = result.value;
        let outcome = "lose";
        let payout = 0;

        if (playerValue > 21) {
          outcome = "bust";
        } else if (dealerValue > 21 || playerValue > dealerValue) {
          outcome = "win";
          payout = table.betAmount * 2;
        } else if (playerValue === dealerValue) {
          outcome = "push";
          payout = table.betAmount;
        }

        if (payout > 0) {
          db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [payout, result.player.id]);
          hasChange = true;
        }

        settlements.push({
          player: result.player,
          hand: result.hand,
          value: playerValue,
          outcome,
          payout,
        });
      }
      if (hasChange) {
        persist();
      }
    });

    const dealerText = `${formatHand(dealerHand)}${dealerValue > 21 ? " (Quá 21)" : ""}`;
    const lines =
      settlements.length === 0
        ? "Không có người chơi hợp lệ."
        : settlements
            .map((s) => {
              const outcomeText =
                s.outcome === "win"
                  ? `Thắng (+${formatNumber(s.payout - table.betAmount)} ${CURRENCY_NAME})`
                  : s.outcome === "push"
                    ? `Hòa (+${formatNumber(s.payout - table.betAmount)} ${CURRENCY_NAME})`
                    : "Thua (-)";
              return `- <@${s.player.id}>: ${formatHand(s.hand)} -> ${outcomeText}`;
            })
            .join("\n");

    await thread.send({
      embeds: [
        {
          color: 0x9b59b6,
          title: "Kết quả ván blackjack",
          fields: [
            { name: "Dealer", value: dealerText },
            { name: "Người chơi", value: lines },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });

    pendingActions.delete(tableId);
    await resetTable(table, thread, "Đã tạo bàn mới, nhấn Tham gia để chơi tiếp.");
  };

  const scheduleCountdown = async (table) => {
    const wasCountdown = table.state === "countdown";
    clearCountdown(table);
    table.state = "countdown";
    table.countdownEndsAt = Date.now() + START_DELAY_MS;
    const thread = await getThread(table.threadId);
    if (thread && !wasCountdown) {
      await thread.send(
        `Da du nguoi de bat dau, van se chay sau ${START_DELAY_MS / 1000}s. Nguoi moi tham gia se reset thoi gian.`
      );
    }
    await refreshLobbyMessage(table, "Sap bat dau (~10s).");
    table.countdownTimeout = setTimeout(() => startRound(table.threadId), START_DELAY_MS);
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
    });

    await interaction.reply({
      content: `Đã tham gia bàn cược **${formatNumber(table.betAmount)} ${CURRENCY_NAME}**.`,
      ephemeral: true,
    });

    if (table.state === "countdown") {
      await thread.send("Có người mới tham gia, reset đếm ngược 10s.");
    }

    await refreshLobbyMessage(table, "Đang chờ bắt đầu, sẽ auto start sau 10s khi có người.");
    await scheduleCountdown(table);

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

    const table = await createTable({
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
    const pending = pendingActions.get(threadId);
    if (!pending) {
      await interaction.reply({ content: "Chưa tới lượt bạn.", ephemeral: true });
      return true;
    }
    if (pending.playerId !== interaction.user.id) {
      await interaction.reply({ content: "Chưa tới lượt bạn.", ephemeral: true });
      return true;
    }
    pending.resolve(action);
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
      const table = await createTable({
        channel,
        betAmount: defaultBet,
        creatorId: "auto",
        interaction: {
          editReply: (payload) => baseMessage.edit(payload),
        },
        note: "Bàn tự khởi động khi bot online.",
      });
      await channel.send(`Đã mở bàn blackjack mặc định tại <#${table.threadId}>.`);
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
