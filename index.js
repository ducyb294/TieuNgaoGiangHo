require("dotenv").config();
const {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
} = require("discord.js");
const { buildInfoCard } = require("./services/infoCard");
const {getDatabase} = require("./db");
const {expToNext} = require("./utils/exp");
const {formatNumber} = require("./utils/format");
const {
    CURRENCY_NAME,
    STAT_LABELS,
    TEXT,
    MAX_STAMINA,
    STAMINA_INTERVAL_MS,
    rollLinhThachReward
} = require("./constants");

const EXP_PER_MINUTE = 1;
const MAX_BASE_NAME_LENGTH = 22;
const INFO_CHANNEL_ID = process.env.INFO_CHANNEL_ID;
const RENAME_CHANNEL_ID = process.env.RENAME_CHANNEL_ID;
const MINING_CHANNEL_ID = process.env.MINING_CHANNEL_ID;

async function withDatabase(callback) {
    const {db, persist, close} = await getDatabase(process.env.DB_PATH);
    try {
        return await callback(db, persist);
    } finally {
        close();
    }
}

async function runPassiveExpTick() {
    try {
        await withDatabase((db, persist) => {
            applyPassiveExpTickAll(db, persist);
        });
    } catch (error) {
        console.error("Passive exp tick failed:", error);
    }
}

(async () => {
    // Catch up exp for downtime before the bot starts handling events.
    await runPassiveExpTick();

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        partials: [Partials.GuildMember],
    });

    client.once(Events.ClientReady, () => {
        console.log(`Ready as ${client.user.tag}`);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        try {
            await withDatabase(async (db, persist) => {
                if (interaction.commandName === "doiten") {
                    await handleRename(interaction, db, persist);
                }

                if (interaction.commandName === "dotpha") {
                    await handleBreakthrough(interaction, db, persist);
                }

                if (interaction.commandName === "info") {
                    await handleInfo(interaction, db, persist);
                }

                if (interaction.commandName === "daomo") {
                    await handleMining(interaction, db, persist);
                }
            });
        } catch (error) {
            console.error("Interaction error:", error);
            if (!interaction.replied) {
                await interaction.reply({
                    content: "Có lỗi xảy ra, vui lòng thử lại.",
                    ephemeral: true,
                });
            }
        }
    });

    setInterval(runPassiveExpTick, 60 * 1000);

    await client.login(process.env.DISCORD_TOKEN);
})().catch((error) => {
    console.error("Bot failed to start:", error);
    process.exit(1);
});

function getUser(db, userId) {
    const stmt = db.prepare(
        `SELECT user_id,
                base_name,
                level,
                exp,
                currency,
                last_exp_timestamp,
                attack,
                defense,
                health,
                dodge,
                accuracy,
                crit_rate,
                crit_resistance,
                armor_penetration,
                armor_resistance,
                stamina,
                last_stamina_timestamp
         FROM users
         WHERE user_id = ?`
    );
    stmt.bind([userId]);
    const hasRow = stmt.step();
    const user = hasRow ? stmt.getAsObject() : null;
    stmt.free();
    return user;
}

function createUser(db, persist, userId, baseName, lastExpTimestamp) {
    const nameToSave = truncateBaseName(baseName);
    db.run(
        `INSERT INTO users (user_id, base_name, level, exp, currency, last_exp_timestamp,
                            attack, defense, health, dodge, accuracy, crit_rate, crit_resistance,
                            armor_penetration, armor_resistance, stamina, last_stamina_timestamp)
         VALUES (?, ?, 1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
        [userId, nameToSave, lastExpTimestamp, MAX_STAMINA, lastExpTimestamp]
    );
    persist();
    return getUser(db, userId);
}

function applyPassiveExpForUser(db, persist, user, now = Date.now()) {
    const last = user.last_exp_timestamp || now;
    const elapsedMinutes = Math.floor((now - last) / 60000);
    if (elapsedMinutes <= 0) {
        return user;
    }

    const gained = elapsedMinutes * EXP_PER_MINUTE;
    const updatedExp = user.exp + gained;
    const updatedTimestamp = last + elapsedMinutes * 60000;
    db.run(
        "UPDATE users SET exp = ?, last_exp_timestamp = ? WHERE user_id = ?",
        [updatedExp, updatedTimestamp, user.user_id]
    );
    persist();
    return {
        ...user,
        exp: updatedExp,
        last_exp_timestamp: updatedTimestamp,
    };
}

function applyStaminaRegen(db, persist, user, now = Date.now()) {
    const currentStamina = Number(user.stamina ?? 0);
    const last = Number(user.last_stamina_timestamp || now);

    if (currentStamina >= MAX_STAMINA) {
        if (last !== now) {
            db.run(
                "UPDATE users SET last_stamina_timestamp = ? WHERE user_id = ?",
                [now, user.user_id]
            );
            persist();
        }
        return {...user, stamina: MAX_STAMINA, last_stamina_timestamp: now};
    }

    const elapsedHours = Math.floor((now - last) / STAMINA_INTERVAL_MS);
    if (elapsedHours <= 0) {
        return user;
    }

    const gain = Math.min(elapsedHours, MAX_STAMINA - currentStamina);
    const newStamina = currentStamina + gain;
    const newLast = last + gain * STAMINA_INTERVAL_MS;
    db.run(
        "UPDATE users SET stamina = ?, last_stamina_timestamp = ? WHERE user_id = ?",
        [newStamina, newLast, user.user_id]
    );
    persist();
    return {...user, stamina: newStamina, last_stamina_timestamp: newLast};
}

function applyPassiveExpTickAll(db, persist) {
    const now = Date.now();
    const stmt = db.prepare(
        "SELECT user_id, exp, last_exp_timestamp FROM users"
    );
    const updates = [];

    while (stmt.step()) {
        const row = stmt.getAsObject();
        const last = row.last_exp_timestamp || now;
        const elapsedMinutes = Math.floor((now - last) / 60000);
        if (elapsedMinutes <= 0) continue;

        const gained = elapsedMinutes * EXP_PER_MINUTE;
        const updatedExp = row.exp + gained;
        const updatedTimestamp = last + elapsedMinutes * 60000;
        updates.push([updatedExp, updatedTimestamp, row.user_id]);
    }

    stmt.free();

    if (updates.length === 0) return;

    db.run("BEGIN");
    updates.forEach((params) => {
        db.run("UPDATE users SET exp = ?, last_exp_timestamp = ? WHERE user_id = ?", params);
    });
    db.run("COMMIT");
    persist();
}

async function handleRename(interaction, db, persist) {
    if (RENAME_CHANNEL_ID && interaction.channelId !== RENAME_CHANNEL_ID) {
        await interaction.reply({content: TEXT.renameChannelOnly, ephemeral: true});
        return;
    }

    const requestedName = interaction.options.getString("ten", true).trim();

    if (!requestedName || !isNameValid(requestedName)) {
        await interaction.reply({content: TEXT.renameInvalid, ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    // 👉 LUÔN reload user từ DB
    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, requestedName, Date.now());
    }

    // 👉 apply passive exp realtime
    user = applyPassiveExpForUser(db, persist, user);

    const cleanedName = truncateBaseName(requestedName);
    db.run("UPDATE users SET base_name = ? WHERE user_id = ?", [
        cleanedName,
        user.user_id,
    ]);
    persist();

    // 👉 reload lại để chắc chắn sync
    user = getUser(db, member.id);

    const nickname = await updateNickname(member, user.base_name, user.level);

    await interaction.reply({
        embeds: [
            {
                color: 0x00ff99,
                title: "✅ Thành công",
                description: `${TEXT.renameSuccess}: **${nickname}**`,
                footer: {text: "/doiten"},
                timestamp: new Date()
            }
        ],
        ephemeral: false
    });
}


async function handleBreakthrough(interaction, db, persist) {
    if (INFO_CHANNEL_ID && interaction.channelId !== INFO_CHANNEL_ID) {
        await interaction.reply({content: TEXT.infoChannelOnly, ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);

    const requiredExp = expToNext(user.level);
    if (user.exp < requiredExp) {
        const missing = requiredExp - user.exp;
        await interaction.reply({
            content: `${TEXT.notEnoughExp} Còn thiếu ${missing} exp để lên level ${user.level + 1}.`,
            ephemeral: true,
        });
        return;
    }

    const {level, exp} = applyLevelUps(db, persist, user);

    // 👉 reload lại user sau khi level up
    user = getUser(db, member.id);

    const nickname = await updateNickname(member, user.base_name, level);

    await interaction.reply({
        embeds: [
            {
                color: 0xffd700,
                title: "🎉 LEVEL UP!",
                description:
                    `**${TEXT.levelUpSuccess}**\n\n` +
                    `🔺 **Level:** ${level}\n` +
                    `✨ **Exp còn lại:** ${exp}\n` +
                    `💰 **${CURRENCY_NAME}:** ${user.currency}`,
                footer: {text: "/dotpha"},
                timestamp: new Date()
            }
        ]
    });
}

async function handleInfo(interaction, db, persist) {
    if (INFO_CHANNEL_ID && interaction.channelId !== INFO_CHANNEL_ID) {
        await interaction.reply({content: TEXT.infoChannelOnly, ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);
    await interaction.deferReply({ephemeral: false});

    const requiredExp = expToNext(user.level);
    const {buffer, fileName} = await buildInfoCard({
        name: user.base_name,
        level: user.level,
        exp: user.exp,
        expRequired: requiredExp,
        avatarUrl: interaction.user.displayAvatarURL({extension: "png", size: 256}),
        stats: {
            attack: user.attack,
            defense: user.defense,
            health: user.health,
            dodge: user.dodge,
            accuracy: user.accuracy,
            crit_rate: user.crit_rate,
            crit_resistance: user.crit_resistance,
            armor_penetration: user.armor_penetration,
            armor_resistance: user.armor_resistance,
        },
        currency: user.currency,
    });

    await interaction.editReply({
        files: [{attachment: buffer, name: fileName}],
        ephemeral: false,
    });
}

async function handleMining(interaction, db, persist) {
    if (MINING_CHANNEL_ID && interaction.channelId !== MINING_CHANNEL_ID) {
        await interaction.reply({content: TEXT.miningChannelOnly, ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);
    user = applyStaminaRegen(db, persist, user);

    const available = Number(user.stamina || 0);
    const now = Date.now();

    if (available <= 0) {
        const elapsed = now - (user.last_stamina_timestamp || now);
        const waitMs = Math.max(0, STAMINA_INTERVAL_MS - elapsed);
        const minutes = Math.ceil(waitMs / 60000);
        await interaction.reply({
            content: `${TEXT.noStamina} Hồi trong khoảng ${minutes} phút.`,
            ephemeral: true,
        });
        return;
    }

    const rewards = [];
    let total = 0;
    for (let i = 0; i < available; i++) {
        const reward = rollLinhThachReward();
        rewards.push(reward);
        total += reward.amount;
    }

    const tierSummary = rewards.reduce((acc, r) => {
        if (!acc[r.tier]) {
            acc[r.tier] = {count: 0, amount: 0};
        }
        acc[r.tier].count += 1;
        acc[r.tier].amount += r.amount;
        return acc;
    }, {});

    db.run(
        "UPDATE users SET currency = currency + ?, stamina = 0, last_stamina_timestamp = ? WHERE user_id = ?",
        [total, now, user.user_id]
    );
    persist();

    const lines = Object.entries(tierSummary)
        .sort((a, b) => b[1].amount - a[1].amount)
        .map(([tier, info]) => `- ${tier}: ${info.count} lượt • +${formatNumber(info.amount)} ${CURRENCY_NAME}`)
        .join("\n");

    await interaction.reply({
        embeds: [
            {
                color: 0x8b5cf6,
                title: "⛏️ Đào mỏ linh thạch",
                description:
                    `Đã đào ${available} lượt và nhận **${formatNumber(total)} ${CURRENCY_NAME}**.\n` +
                    (lines ? `\n${lines}` : ""),
                footer: {text: `/daomo • Thể lực: 0/${MAX_STAMINA}`},
                timestamp: new Date()
            }
        ]
    });
}


function applyLevelUps(db, persist, user) {
    let currentLevel = user.level;
    let currentExp = user.exp;
    let levelUps = 0;

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
            user.user_id,
        ]);
        persist();
    }

    return {level: currentLevel, exp: currentExp, levelUps};
}


function getBaseNameFromMember(member) {
    const raw =
        (member && (member.nickname || member.displayName || member.user?.username)) ||
        "Hiệp Khách";
    const cleaned = raw.replace(/\s*-\s*Level\s+\d+$/i, "").trim();
    return cleaned || "Hiệp Khách";
}

function truncateBaseName(name) {
    return (name || "Hiệp Khách").trim().slice(0, MAX_BASE_NAME_LENGTH);
}

function isNameValid(name) {
    return /^[\p{L}\p{N} ]+$/u.test(name);
}

async function updateNickname(member, baseName, level) {
    const nickname = formatNickname(baseName, level);
    try {
        await member.setNickname(nickname);
    } catch (error) {
        console.error(`Không thể đổi tên ${member.id}:`, error);
    }
    return nickname;
}

function formatNickname(baseName, level) {
    return `${baseName} - Level ${level}`;
}