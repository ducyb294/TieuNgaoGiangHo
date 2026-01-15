const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const LIXI_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

function createLiXiService({
  getUser,
  createUser,
  applyPassiveExpForUser,
  formatNumber,
  getBaseNameFromMember,
  CURRENCY_NAME,
}) {
  const getLastInsertId = (db) => {
    const res = db.exec("SELECT last_insert_rowid() AS id");
    return res && res[0] && res[0].values && res[0].values[0]
      ? Number(res[0].values[0][0])
      : null;
  };

  const mapPacketRow = (row) => ({
    id: Number(row.id),
    creatorId: row.creator_id,
    totalAmount: Number(row.total_amount || 0),
    slots: Number(row.slots || 0),
    status: row.status,
    createdAt: row.created_at ? Number(row.created_at) : null,
    completedAt: row.completed_at ? Number(row.completed_at) : null,
    messageId: row.message_id || null,
    channelId: row.channel_id || null,
  });

  const mapParticipantRow = (row) => ({
    userId: row.user_id,
    share: row.share === null || row.share === undefined ? null : Number(row.share),
    joinedAt: row.joined_at ? Number(row.joined_at) : null,
  });

  const getPacket = (db, id) => {
    const stmt = db.prepare(
      "SELECT id, creator_id, total_amount, slots, status, created_at, completed_at, message_id, channel_id FROM lixi_packets WHERE id = ?"
    );
    stmt.bind([id]);
    const has = stmt.step();
    const packet = has ? mapPacketRow(stmt.getAsObject()) : null;
    stmt.free();
    return packet;
  };

  const getParticipants = (db, lixiId) => {
    const stmt = db.prepare(
      "SELECT user_id, share, joined_at FROM lixi_participants WHERE lixi_id = ? ORDER BY joined_at ASC"
    );
    stmt.bind([lixiId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(mapParticipantRow(stmt.getAsObject()));
    }
    stmt.free();
    return rows;
  };

  const buildComponents = (packet) => {
    const button = new ButtonBuilder()
      .setCustomId(`lixi:${packet.id}`)
      .setLabel(packet.status === LIXI_STATUS.PENDING ? "Nhận xì lì" : "Đã hết")
      .setStyle(ButtonStyle.Success)
      .setDisabled(packet.status !== LIXI_STATUS.PENDING);
    return [new ActionRowBuilder().addComponents(button)];
  };

  const buildEmbed = (packet, participants) => {
    const participantLines = participants.length
      ? participants
          .map((p, idx) => {
            const prefix = `${idx + 1}. <@${p.userId}>`;
            if (p.share !== null && p.share !== undefined) {
              return `${prefix} +${formatNumber(p.share)} ${CURRENCY_NAME}`;
            }
            return prefix;
          })
          .join("\n")
      : "- Chưa có ai nhận";

    const desc =
      `Người gửi: <@${packet.creatorId}>` +
      `\nTổng: **${formatNumber(packet.totalAmount)} ${CURRENCY_NAME}**` +
      `\nSlot: ${participants.length}/${packet.slots}` +
      `\n\nNgười nhận:\n${participantLines}`;

    return {
      embed: {
        color: packet.status === LIXI_STATUS.COMPLETED ? 0x2ecc71 : 0xe67e22,
        title: "Lì xì ngân lượng",
        description: desc,
        footer: { text: packet.status === LIXI_STATUS.PENDING ? "Bấm để tham gia" : "Đã chia xong" },
        timestamp: packet.createdAt ? new Date(packet.createdAt) : new Date(),
      },
      components: packet.status === LIXI_STATUS.PENDING ? buildComponents(packet) : [],
    };
  };

  const shuffle = (arr) => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const buildShares = (total, count) => {
    const shares = [];
    let remaining = total;
    for (let i = 0; i < count; i++) {
      const left = count - i;
      if (left === 1) {
        shares.push(remaining);
        break;
      }
      const maxForThis = remaining - (left - 1);
      const amount = Math.floor(Math.random() * maxForThis) + 1;
      shares.push(amount);
      remaining -= amount;
    }
    return shares;
  };

  const finalizePacket = (db, persist, packet, participants) => {
    if (!participants.length) return [];
    const shuffled = shuffle(participants);
    const shares = buildShares(packet.totalAmount, shuffled.length);

    const payouts = shuffled.map((p, idx) => ({
      ...p,
      share: shares[idx],
    }));

    db.run("BEGIN");
    payouts.forEach((p) => {
      db.run(
        "UPDATE lixi_participants SET share = ? WHERE lixi_id = ? AND user_id = ?",
        [p.share, packet.id, p.userId]
      );
      db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [p.share, p.userId]);
    });
    db.run("UPDATE lixi_packets SET status = ?, completed_at = ? WHERE id = ?", [
      LIXI_STATUS.COMPLETED,
      Date.now(),
      packet.id,
    ]);
    db.run("COMMIT");
    persist();

    return payouts;
  };

  const handleCreate = async (interaction, db, persist) => {
    const slots = Number(interaction.options.getInteger("songuoi", true));
    const total = Number(interaction.options.getInteger("nganluong", true));

    if (slots < 1) {
      await interaction.reply({ content: "Số người nhận phải lớn hơn 0.", ephemeral: true });
      return;
    }
    if (total <= 0) {
      await interaction.reply({ content: "Lỗi.", ephemeral: true });
      return;
    }
    if (total < slots) {
      await interaction.reply({ content: "Tổng ngân lượng phải lớn hơn hoặc bằng số người nhận.", ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(
        db,
        persist,
        member.id,
        getBaseNameFromMember ? getBaseNameFromMember(member) : member.displayName || member.user.username,
        Date.now()
      );
    }

    user = applyPassiveExpForUser(db, persist, user);

    if (Number(user.currency || 0) < total) {
      await interaction.reply({ content: "Không đủ ngân lượng.", ephemeral: true });
      return;
    }

    const now = Date.now();
    let packetId = null;

    try {
      db.run("BEGIN");
      db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [total, user.user_id]);
      db.run(
        `INSERT INTO lixi_packets (creator_id, total_amount, slots, status, created_at, channel_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.user_id, total, slots, LIXI_STATUS.PENDING, now, interaction.channelId]
      );
      packetId = getLastInsertId(db);
      db.run("COMMIT");
      persist();
    } catch (error) {
      db.run("ROLLBACK");
      persist();
      throw error;
    }

    const packet = {
      id: packetId,
      creatorId: user.user_id,
      totalAmount: total,
      slots,
      status: LIXI_STATUS.PENDING,
      createdAt: now,
      completedAt: null,
      messageId: null,
      channelId: interaction.channelId,
    };

    const { embed, components } = buildEmbed(packet, []);
    let message = null;
    try {
      message = await interaction.reply({
        embeds: [embed],
        components,
        fetchReply: true,
      });
    } catch (error) {
      db.run("BEGIN");
      db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [total, user.user_id]);
      db.run("UPDATE lixi_packets SET status = ?, completed_at = ? WHERE id = ?", [
        LIXI_STATUS.CANCELLED,
        Date.now(),
        packet.id,
      ]);
      db.run("COMMIT");
      persist();
      throw error;
    }

    if (message && message.id) {
      db.run("UPDATE lixi_packets SET message_id = ? WHERE id = ?", [message.id, packet.id]);
      persist();
    }
  };

  const handleButton = async (interaction, db, persist) => {
    const [prefix, idStr] = (interaction.customId || "").split(":");
    if (prefix !== "lixi") return false;

    const packetId = Number(idStr);
    if (!packetId) {
      await interaction.reply({ content: "Lì xì không tồn tại.", ephemeral: true });
      return true;
    }

    const packet = getPacket(db, packetId);
    if (!packet) {
      await interaction.reply({ content: "Lì xì không tồn tại hoặc đã bị xoá.", ephemeral: true });
      return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
      user = createUser(
        db,
        persist,
        member.id,
        getBaseNameFromMember ? getBaseNameFromMember(member) : member.displayName || member.user.username,
        Date.now()
      );
    }
    user = applyPassiveExpForUser(db, persist, user);

    let participants = getParticipants(db, packet.id);

    if (packet.status !== LIXI_STATUS.PENDING) {
      const { embed, components } = buildEmbed(packet, participants);
      await interaction.reply({
        content: "Lì xì này đã kết thúc.",
        embeds: [embed],
        components,
        ephemeral: true,
      });
      return true;
    }

    if (packet.creatorId === user.user_id) {
      await interaction.reply({ content: "Người gửi không được tham gia.", ephemeral: true });
      return true;
    }

    if (participants.some((p) => p.userId === user.user_id)) {
      await interaction.reply({ content: "Bạn đã tham gia nhận lì xì này.", ephemeral: true });
      return true;
    }

    db.run("INSERT OR IGNORE INTO lixi_participants (lixi_id, user_id, joined_at) VALUES (?, ?, ?)", [
      packet.id,
      user.user_id,
      Date.now(),
    ]);
    persist();

    participants = getParticipants(db, packet.id);

    if (participants.length === packet.slots) {
      const payouts = finalizePacket(db, persist, packet, participants);
      const completedPacket = { ...packet, status: LIXI_STATUS.COMPLETED, completedAt: Date.now() };
      const { embed, components } = buildEmbed(completedPacket, payouts);
      await interaction.update({ embeds: [embed], components });
      const selfShare = payouts.find((p) => p.userId === user.user_id);
      if (selfShare) {
        await interaction.followUp({
          content: `Ban nhan ${formatNumber(selfShare.share)} ${CURRENCY_NAME}!`,
          ephemeral: true,
        });
      }
      return true;
    }

    const { embed, components } = buildEmbed(packet, participants);
    await interaction.update({ embeds: [embed], components });
    await interaction.followUp({ content: "Đã tham gia, chờ đủ người.", ephemeral: true });
    return true;
  };

  return {
    handleCreate,
    handleButton,
  };
}

module.exports = createLiXiService;
