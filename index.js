require("dotenv").config();
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const { buildInfoCard } = require("./services/infoCard");
const { buildChanLeChartImage } = require("./services/chanLeChart");
const { simulateCombat } = require("./services/combat");
const createBicanhService = require("./services/bicanh");
const createShopService = require("./services/shop");
const createCasinoService = require("./services/casino");
const createBauCuaService = require("./services/bauCua");
const createLiXiService = require("./services/lixi");
const createBlackjackService = require("./services/blackjack");
const createGiftCodeService = require("./services/giftcode");
const {getDatabase} = require("./db");
const {expToNext} = require("./utils/exp");
const {formatNumber} = require("./utils/format");
const {applyLevelBonus} = require("./utils/stats");
const {
    CURRENCY_NAME,
    STAT_LABELS,
    TEXT,
    MAX_STAMINA,
    STAMINA_INTERVAL_MS,
    CHANLE_PAYOUT_RATE,
    rollLinhThachReward,
    BAUCUA_COUNTDOWN_MS,
    BAUCUA_LOCK_WINDOW_MS,
    BAUCUA_FACES,
    CASINO_OWNER_DURATION_MS,
    CASINO_COMMISSION_RATE,
    BICANH_DAILY_CHALLENGES
} = require("./constants");

const EXP_PER_MINUTE = 1;
const MAX_BASE_NAME_LENGTH = 22;
const INFO_CHANNEL_ID = process.env.INFO_CHANNEL_ID;
const RENAME_CHANNEL_ID = process.env.RENAME_CHANNEL_ID;
const MINING_CHANNEL_ID = process.env.MINING_CHANNEL_ID;
const CHANLE_CHANNEL_ID = process.env.CHANLE_CHANNEL_ID;
const BICANH_CHANNEL_ID = process.env.BICANH_CHANNEL_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;
const BAUCUA_CHANNEL_ID = process.env.BAUCUA_CHANNEL_ID;
const CASINO_CHANNEL_ID = process.env.CASINO_CHANNEL_ID;
const CASINO_ROLE_ID = process.env.CASINO_ROLE_ID;
const FARM_INTERVAL_MS = 60 * 1000;
const SHOP_CHANNEL_ID = process.env.SHOP_CHANNEL_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ERROR_LOG_CHANNEL_ID = process.env.ERROR_LOG_CHANNEL_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const BLACKJACK_CHANNEL_ID = process.env.BLACKJACK_CHANNEL_ID;
const BLACKJACK_DEFAULT_BET = Number(process.env.BLACKJACK_DEFAULT_BET || 0);
const LEADERBOARD_REFRESH_MS = 5 * 60 * 1000;
const GIFT_CODE_CHANNEL_ID = process.env.GIFT_CODE_CHANNEL_ID;
const AUTO_BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MOUNT_ITEMS_PATH = path.join(__dirname, "data", "items");
const MOUNT_PAGE_SIZE = 10;
const MOUNT_MAX_LEVEL = 100;
const MOUNT_EXP_PER_LEVEL = 1000;
const MOUNT_BREAK_COST = 100000000;
const MOUNT_BREAK_SUCCESS_RATE = 0.2;

const MOUNT_STAT_POOL = [
    { id: "attack", value: 1000, type: "flat", label: STAT_LABELS.attack },
    { id: "defense", value: 1000, type: "flat", label: STAT_LABELS.defense },
    { id: "health", value: 1000, type: "flat", label: STAT_LABELS.health },
    { id: "critRate", value: 1, type: "percent", label: STAT_LABELS.critRate },
    { id: "accuracy", value: 1, type: "percent", label: STAT_LABELS.accuracy },
    { id: "dodge", value: 1, type: "percent", label: STAT_LABELS.dodge },
    {
        id: "critDamageResistance",
        value: 1,
        type: "percent",
        label: STAT_LABELS.critDamageResistance,
    },
    {
        id: "armorPenetration",
        value: 1,
        type: "percent",
        label: STAT_LABELS.armorPenetration,
    },
    {
        id: "armorResistance",
        value: 1,
        type: "percent",
        label: STAT_LABELS.armorResistance,
    },
];

let clientRef = null;
let bicanhService = null;
let shopService = null;
let bauCuaService = null;
let casinoService = null;
let lixiService = null;
let blackjackService = null;
let giftCodeService = null;

async function sendErrorLog(title, error) {
    if (!clientRef || !ERROR_LOG_CHANNEL_ID) return;
    try {
        const channel = await clientRef.channels.fetch(ERROR_LOG_CHANNEL_ID);
        if (channel) {
            const errorMessage = error?.stack || error?.message || String(error);
            await channel.send({
                embeds: [{
                    color: 0xe74c3c,
                    title: `❌ ${title}`,
                    description: `\`\`\`\n${errorMessage.slice(0, 3800)}\n\`\`\``,
                    timestamp: new Date().toISOString(),
                }]
            });
        }
    } catch (_) {}
}

process.on('uncaughtException', (err) => {
    sendErrorLog('Uncaught Exception', err);
});

process.on('unhandledRejection', (reason) => {
    sendErrorLog('Unhandled Rejection', reason);
});

async function withDatabase(callback) {
    const {db, persist, close} = await getDatabase(process.env.DB_PATH);
    try {
        return await callback(db, persist);
    } finally {
        close();
    }
}

function loadMountDefinitions() {
    if (!fs.existsSync(MOUNT_ITEMS_PATH)) return {};
    const content = fs.readFileSync(MOUNT_ITEMS_PATH, "utf8");
    const lines = content.split(/\r?\n/);
    const map = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(/[\t|,]+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const id = Number(parts[0]);
        if (!Number.isFinite(id)) continue;
        const name = parts.slice(1).join(" ").trim();
        if (!name) continue;
        map[id] = {id, name};
    }
    return map;
}

function getMountName(mountId) {
    const defs = loadMountDefinitions();
    return defs[mountId]?.name || `Thú cưỡi #${mountId}`;
}

function parseMountStats(raw) {
    if (!raw) return [];
    try {
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (_) {
        return [];
    }
}

function rollMountBaseStats() {
    const pool = MOUNT_STAT_POOL.map((stat) => ({...stat}));
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 4).map((stat) => ({
        id: stat.id,
        value: stat.value,
        type: stat.type,
    }));
}

function getUserMounts(db, userId) {
    const stmt = db.prepare(
        `SELECT user_id, mount_id, stats_unlocked, base_stats, level, exp, star, equipped
         FROM user_mounts
         WHERE user_id = ?
         ORDER BY mount_id ASC`
    );
    stmt.bind([userId]);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getUserMount(db, userId, mountId) {
    const stmt = db.prepare(
        `SELECT user_id, mount_id, stats_unlocked, base_stats, level, exp, star, equipped
         FROM user_mounts
         WHERE user_id = ? AND mount_id = ?`
    );
    stmt.bind([userId, mountId]);
    const hasRow = stmt.step();
    const row = hasRow ? stmt.getAsObject() : null;
    stmt.free();
    return row;
}

function getEquippedMount(db, userId) {
    const stmt = db.prepare(
        `SELECT user_id, mount_id, stats_unlocked, base_stats, level, exp, star, equipped
         FROM user_mounts
         WHERE user_id = ? AND equipped = 1
         LIMIT 1`
    );
    stmt.bind([userId]);
    const hasRow = stmt.step();
    const row = hasRow ? stmt.getAsObject() : null;
    stmt.free();
    return row;
}

function getEquippedMountBonus(db, userId) {
    const mount = getEquippedMount(db, userId);
    if (!mount || Number(mount.stats_unlocked || 0) === 0) {
        return {
            attack: 0,
            defense: 0,
            health: 0,
            dodge: 0,
            accuracy: 0,
            crit_rate: 0,
            crit_resistance: 0,
            armor_penetration: 0,
            armor_resistance: 0,
        };
    }

    const baseStats = parseMountStats(mount.base_stats);
    if (!baseStats.length) {
        return {
            attack: 0,
            defense: 0,
            health: 0,
            dodge: 0,
            accuracy: 0,
            crit_rate: 0,
            crit_resistance: 0,
            armor_penetration: 0,
            armor_resistance: 0,
        };
    }

    const level = Math.max(1, Number(mount.level || 1));
    const star = Math.max(1, Number(mount.star || 1));

    const bonuses = {
        attack: 0,
        defense: 0,
        health: 0,
        dodge: 0,
        accuracy: 0,
        crit_rate: 0,
        crit_resistance: 0,
        armor_penetration: 0,
        armor_resistance: 0,
    };

    const map = {
        attack: "attack",
        defense: "defense",
        health: "health",
        critRate: "crit_rate",
        accuracy: "accuracy",
        dodge: "dodge",
        critDamageResistance: "crit_resistance",
        armorPenetration: "armor_penetration",
        armorResistance: "armor_resistance",
    };

    baseStats.forEach((stat) => {
        const key = map[stat.id];
        if (!key) return;
        const total = Number(stat.value || 0) * star * level;
        if (!Number.isFinite(total)) return;
        bonuses[key] += total;
    });

    return bonuses;
}

function setEquippedMount(db, persist, userId, mountId) {
    db.run("BEGIN");
    db.run("UPDATE user_mounts SET equipped = 0 WHERE user_id = ?", [userId]);
    db.run(
        "UPDATE user_mounts SET equipped = 1 WHERE user_id = ? AND mount_id = ?",
        [userId, mountId]
    );
    db.run("COMMIT");
    persist();
}

function buildMountStatLines(mount) {
    const baseStats = parseMountStats(mount.base_stats);
    if (!baseStats.length) return ["Chưa mở chỉ số."];
    const level = Math.max(1, Number(mount.level || 1));
    const star = Math.max(1, Number(mount.star || 1));
    return baseStats.map((stat) => {
        const def = MOUNT_STAT_POOL.find((s) => s.id === stat.id);
        const label = def?.label || stat.id;
        const statType = stat.type || def?.type;
        const total = Number(stat.value || 0) * star * level;
        const suffix = statType === "percent" ? "%" : "";
        return `• ${label}: +${formatNumber(total)}${suffix}`;
    });
}

function buildMountInfoEmbed(mount, title = "Thông tin thú cưỡi") {
    const name = getMountName(Number(mount.mount_id));
    const level = Math.max(1, Number(mount.level || 1));
    const exp = Math.max(0, Number(mount.exp || 0));
    const star = Math.max(1, Number(mount.star || 1));
    const lines = buildMountStatLines(mount);
    const expLabel =
        level >= MOUNT_MAX_LEVEL
            ? "Đã đạt level 100"
            : `${formatNumber(exp)}/${formatNumber(MOUNT_EXP_PER_LEVEL)} exp`;

    return {
        color: 0x8e44ad,
        title: `🐎 ${title}`,
        description: `**${name}**\nLevel ${level} • ★${star}\n${expLabel}`,
        fields: [
            {
                name: "Chỉ số",
                value: lines.join("\n"),
            },
        ],
        timestamp: new Date(),
    };
}

function buildMountListEmbed(userId, mounts, page) {
    const total = mounts.length;
    const totalPages = Math.max(1, Math.ceil(total / MOUNT_PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const start = safePage * MOUNT_PAGE_SIZE;
    const slice = mounts.slice(start, start + MOUNT_PAGE_SIZE);
    const lines = slice.map((mount) => {
        const name = getMountName(Number(mount.mount_id));
        const level = Math.max(1, Number(mount.level || 1));
        const star = Math.max(1, Number(mount.star || 1));
        const equipMark = Number(mount.equipped || 0) ? " ✅" : "";
        return `• [ID ${mount.mount_id}] ${name}${equipMark} — Lv ${level} • ★${star}`;
    });

    const embed = {
        color: 0x9b59b6,
        title: "🐎 Danh sách thú cưỡi",
        description: lines.length ? lines.join("\n") : "Chưa có thú cưỡi nào.",
        footer: {text: `Trang ${safePage + 1}/${totalPages}`},
        timestamp: new Date(),
    };

    const components = [];
    if (totalPages > 1) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mounts:prev:${userId}:${safePage}`)
                .setLabel("Trang trước")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(`mounts:next:${userId}:${safePage}`)
                .setLabel("Trang sau")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= totalPages - 1)
        );
        components.push(row);
    }

    return {embed, components};
}

(async () => {

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        partials: [Partials.GuildMember],
    });

    bicanhService = createBicanhService({
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
        clientRefGetter: () => clientRef,
        BICANH_DAILY_CHALLENGES,
        expToNext,
        INFO_CHANNEL_ID,
        updateNickname,
        getEquippedMountBonus,
    });

    shopService = createShopService({
        withDatabase,
        getUser,
        createUser,
        applyPassiveExpForUser,
        formatNumber,
        getBaseNameFromMember,
        CURRENCY_NAME,
        TEXT,
        SHOP_CHANNEL_ID,
    });

    casinoService = createCasinoService({
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
        clientRefGetter: () => clientRef,
    });

    bauCuaService = createBauCuaService({
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
        clientRefGetter: () => clientRef,
    });

    lixiService = createLiXiService({
        getUser,
        createUser,
        applyPassiveExpForUser,
        formatNumber,
        getBaseNameFromMember,
        CURRENCY_NAME,
    });

    blackjackService = createBlackjackService({
        withDatabase,
        getUser,
        createUser,
        applyPassiveExpForUser,
        formatNumber,
        getBaseNameFromMember,
        CURRENCY_NAME,
        TEXT,
        BLACKJACK_CHANNEL_ID,
        defaultBet: BLACKJACK_DEFAULT_BET,
        clientRefGetter: () => clientRef,
    });

    giftCodeService = createGiftCodeService({
        withDatabase,
        getUser,
        createUser,
        applyPassiveExpForUser,
        formatNumber,
        getBaseNameFromMember,
        CURRENCY_NAME,
        TEXT,
        GIFT_CODE_CHANNEL_ID,
    });

    client.once(Events.ClientReady, async () => {
        console.log(`Ready as ${client.user.tag}`);
        clientRef = client;
        bicanhService.startFarmLoop();
        bauCuaService.init();
        casinoService.init();
        blackjackService.init();
        if (giftCodeService) {
            await withDatabase(async (db, persist) => {
                giftCodeService.ensureGiftCode(db, persist);
            });
        }
        scheduleAutoBackup(client);

        await ensureLeaderboardMessages(client);
        startLeaderboardRefreshLoop(client);

        // Thông báo bot đã khởi động vào kênh admin
        if (ADMIN_CHANNEL_ID) {
            try {
                const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
                if (adminChannel) {
                    await adminChannel.send("Bot đã khởi động thành công!");
                }
            } catch (error) {
                console.error("Không thể gửi thông báo khởi động:", error);
            }
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        try {
            await withDatabase(async (db, persist) => {
                if (interaction.isChatInputCommand()) {
                    if (interaction.commandName === "doiten") {
                        await handleRename(interaction, db, persist);
                    }

                    if (interaction.commandName === "info") {
                        await handleInfo(interaction, db, persist);
                    }

                    if (interaction.commandName === "thucuoi") {
                        await handleThuCuoi(interaction, db, persist);
                    }

                    if (interaction.commandName === "sudungthucuoi") {
                        await handleSuDungThuCuoi(interaction, db, persist);
                    }

                    if (interaction.commandName === "dotphathucuoi") {
                        await handleDotPhaThuCuoi(interaction, db, persist);
                    }

                    if (interaction.commandName === "sudungco") {
                        await handleSuDungCo(interaction, db, persist);
                    }

                    if (interaction.commandName === "daomo") {
                        await handleMining(interaction, db, persist);
                    }

                    if (interaction.commandName === "chanle") {
                        await handleChanLe(interaction, db, persist, false);
                    }

                    if (interaction.commandName === "allinchanle") {
                        await handleChanLe(interaction, db, persist, true);
                    }

                    if (interaction.commandName === "blackjack") {
                        await blackjackService.handleCommand(interaction, db, persist);
                    }

                    if (interaction.commandName === "baucua") {
                        await bauCuaService.handleBet(interaction, db, persist);
                    }

                    if (interaction.commandName === "lixi") {
                        await lixiService.handleCreate(interaction, db, persist);
                    }

                    if (interaction.commandName === "npc") {
                        await casinoService.handleNpc(interaction, db, persist);
                    }

                    if (interaction.commandName === "huynpc") {
                        await casinoService.handleHuyNpc(interaction, db, persist);
                    }

                    if (interaction.commandName === "setmaxchanle") {
                        await casinoService.handleSetMaxChanLe(interaction, db, persist);
                    }

                    if (interaction.commandName === "settaisanchusongbai") {
                        await casinoService.handleSetMinBalance(interaction, db, persist);
                    }

                    if (interaction.commandName === "taisan") {
                        await handleTaiSan(interaction, db, persist);
                    }

                    if (interaction.commandName === "hanhtrang") {
                        await handleHanhTrang(interaction, db, persist);
                    }

                    if (interaction.commandName === "hamnguc") {
                        await bicanhService.handleBicanh(interaction, db, persist);
                    }

                    if (interaction.commandName === "khieuchienhamnguc") {
                        await bicanhService.handleSoTaiThuVe(interaction, db, persist);
                    }

                    if (interaction.commandName === "farmhamnguc") {
                        await bicanhService.handleFarmBicanh(interaction, db, persist);
                    }

                    if (interaction.commandName === "nhanthuonghamnguc") {
                        await bicanhService.handleClaimFarm(interaction, db, persist);
                    }

                    if (interaction.commandName === "shop") {
                        await shopService.handleShop(interaction, db, persist);
                    }

                    if (interaction.commandName === "muasll") {
                        await shopService.handleBulkPurchase(interaction, db, persist);
                    }

                    if (interaction.commandName === "backup") {
                        await handleBackup(interaction, db, persist);
                    }

                    if (interaction.commandName === "update") {
                        await handleUpdate(interaction, db, persist);
                    }

                    if (interaction.commandName === "backupenv") {
                        await handleBackupEnv(interaction);
                    }

                    if (interaction.commandName === "uploadenv") {
                        await handleUploadEnv(interaction);
                    }

                    if (interaction.commandName === "giftcode") {
                        await giftCodeService.handleGiftCode(interaction, db, persist);
                    }
                } else if (interaction.isButton()) {
                    const lixiHandled = await lixiService.handleButton(interaction, db, persist);
                    if (lixiHandled) return;

                    const mountHandled = await handleMountListButton(interaction, db, persist);
                    if (mountHandled) return;

                    const handled = await shopService.handleButton(interaction, db, persist);
                    if (handled) return;

                    const blackjackHandled = await blackjackService.handleButton(interaction, db, persist);
                    if (blackjackHandled) return;
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

    await client.login(process.env.DISCORD_TOKEN);

    client.on("guildCreate", guild => {
        if (guild.id !== process.env.GUILD_ID) {
            guild.leave();
        }
    });
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
                grass,
                bicanh_level,
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
                last_stamina_timestamp,
                chanle_played,
                chanle_won
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
        `INSERT INTO users (user_id, base_name, level, exp, currency, grass, bicanh_level, last_exp_timestamp,
                            attack, defense, health, dodge, accuracy, crit_rate, crit_resistance,
                            armor_penetration, armor_resistance, stamina, last_stamina_timestamp,
                            chanle_played, chanle_won)
         VALUES (?, ?, 1, 0, 0, 0, 1, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, 0, 0)`,
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

function getLeaderboardState(db) {
    const stmt = db.prepare(
        "SELECT channel_id, daigia_message_id, caothu_message_id FROM leaderboard_messages WHERE id = 1"
    );
    const hasRow = stmt.step();
    const row = hasRow ? stmt.getAsObject() : null;
    stmt.free();
    return row;
}

function saveLeaderboardState(db, persist, channelId, daiGiaMessageId, caoThuMessageId) {
    db.run(
        `INSERT INTO leaderboard_messages (id, channel_id, daigia_message_id, caothu_message_id)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           channel_id = excluded.channel_id,
           daigia_message_id = excluded.daigia_message_id,
           caothu_message_id = excluded.caothu_message_id`,
        [channelId, daiGiaMessageId, caoThuMessageId]
    );
    persist();
}

function buildTopDaiGiaEmbed(db) {
    const stmt = db.prepare(
        "SELECT user_id, base_name, currency FROM users ORDER BY currency DESC LIMIT 10"
    );
    const rows = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
            user_id: row.user_id,
            base_name: row.base_name,
            currency: Number(row.currency || 0),
        });
    }
    stmt.free();

    const lines = rows.map((row, idx) =>
        `${idx + 1}. <@${row.user_id}> | **${formatNumber(row.currency)} ${CURRENCY_NAME}**`
    );

    return {
        color: 0xf1c40f,
        title: "Top Đại Gia",
        description: lines.length ? lines.join("\n") : "Chưa có dữ liệu.",
        timestamp: new Date(),
    };
}

function buildTopCaoThuEmbed(db) {
    const stmt = db.prepare(
        "SELECT user_id, base_name, level, exp FROM users ORDER BY level DESC, exp DESC LIMIT 10"
    );
    const rows = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
            user_id: row.user_id,
            base_name: row.base_name,
            level: Number(row.level || 0),
            exp: Number(row.exp || 0),
        });
    }
    stmt.free();

    const lines = rows.map((row, idx) =>
        `${idx + 1}. <@${row.user_id}> | Exp ${formatNumber(row.exp)}`
    );

    return {
        color: 0x3498db,
        title: "Top Cao Thủ",
        description: lines.length ? lines.join("\n") : "Chưa có dữ liệu.",
        timestamp: new Date(),
    };
}

async function ensureLeaderboardMessages(client) {
    if (!LEADERBOARD_CHANNEL_ID) return;

    await withDatabase(async (db, persist) => {
        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        if (!channel) return;

        const state = getLeaderboardState(db);
        let daiGiaMessage = null;
        let caoThuMessage = null;

        if (state?.daigia_message_id) {
            try {
                daiGiaMessage = await channel.messages.fetch(state.daigia_message_id);
            } catch (_) {}
        }

        if (state?.caothu_message_id) {
            try {
                caoThuMessage = await channel.messages.fetch(state.caothu_message_id);
            } catch (_) {}
        }

        applyPassiveExpTickAll(db, persist);

        if (!daiGiaMessage) {
            daiGiaMessage = await channel.send({ embeds: [buildTopDaiGiaEmbed(db)] });
        }

        if (!caoThuMessage) {
            caoThuMessage = await channel.send({ embeds: [buildTopCaoThuEmbed(db)] });
        }

        saveLeaderboardState(db, persist, channel.id, daiGiaMessage.id, caoThuMessage.id);

        await daiGiaMessage.edit({ embeds: [buildTopDaiGiaEmbed(db)] });
        await caoThuMessage.edit({ embeds: [buildTopCaoThuEmbed(db)] });
    });
}

function startLeaderboardRefreshLoop(client) {
    if (!LEADERBOARD_CHANNEL_ID) return;

    setInterval(() => {
        refreshLeaderboardMessages(client).catch((error) => {
            console.error("Leaderboard refresh error:", error);
            sendErrorLog("Leaderboard refresh error", error);
        });
    }, LEADERBOARD_REFRESH_MS);
}

async function refreshLeaderboardMessages(client) {
    if (!LEADERBOARD_CHANNEL_ID) return;

    await withDatabase(async (db, persist) => {
        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        if (!channel) return;

        const state = getLeaderboardState(db);
        let daiGiaMessage = null;
        let caoThuMessage = null;

        if (state?.daigia_message_id) {
            try {
                daiGiaMessage = await channel.messages.fetch(state.daigia_message_id);
            } catch (_) {}
        }

        if (state?.caothu_message_id) {
            try {
                caoThuMessage = await channel.messages.fetch(state.caothu_message_id);
            } catch (_) {}
        }

        applyPassiveExpTickAll(db, persist);

        if (!daiGiaMessage) {
            daiGiaMessage = await channel.send({ embeds: [buildTopDaiGiaEmbed(db)] });
        } else {
            await daiGiaMessage.edit({ embeds: [buildTopDaiGiaEmbed(db)] });
        }

        if (!caoThuMessage) {
            caoThuMessage = await channel.send({ embeds: [buildTopCaoThuEmbed(db)] });
        } else {
            await caoThuMessage.edit({ embeds: [buildTopCaoThuEmbed(db)] });
        }

        saveLeaderboardState(db, persist, channel.id, daiGiaMessage.id, caoThuMessage.id);
    });
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

    const mountBonus = getEquippedMountBonus(db, user.user_id);
    const baseStats = {
        attack: Number(user.attack || 0),
        defense: Number(user.defense || 0),
        health: Number(user.health || 0),
        dodge: Number(user.dodge || 0),
        accuracy: Number(user.accuracy || 0),
        crit_rate: Number(user.crit_rate || 0),
        crit_resistance: Number(user.crit_resistance || 0),
        armor_penetration: Number(user.armor_penetration || 0),
        armor_resistance: Number(user.armor_resistance || 0),
    };
    const totalStats = {
        attack: baseStats.attack + mountBonus.attack,
        defense: baseStats.defense + mountBonus.defense,
        health: baseStats.health + mountBonus.health,
        dodge: baseStats.dodge + mountBonus.dodge,
        accuracy: baseStats.accuracy + mountBonus.accuracy,
        crit_rate: baseStats.crit_rate + mountBonus.crit_rate,
        crit_resistance: baseStats.crit_resistance + mountBonus.crit_resistance,
        armor_penetration: baseStats.armor_penetration + mountBonus.armor_penetration,
        armor_resistance: baseStats.armor_resistance + mountBonus.armor_resistance,
    };
    const requiredExp = expToNext(user.level);
    const {buffer, fileName} = await buildInfoCard({
        name: user.base_name,
        level: user.level,
        exp: user.exp,
        expRequired: requiredExp,
        avatarUrl: interaction.user.displayAvatarURL({extension: "png", size: 256}),
        stats: totalStats,
        baseStats,
        bonusStats: mountBonus,
        currency: user.currency,
    });

    const equippedMount = getEquippedMount(db, user.user_id);
    const embeds = equippedMount ? [buildMountInfoEmbed(equippedMount, "Thú cưỡi đang dùng")] : [];

    await interaction.editReply({
        files: [{attachment: buffer, name: fileName}],
        embeds,
        ephemeral: false,
    });
}

async function handleThuCuoi(interaction, db, persist) {
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

    const mountId = interaction.options.getInteger("id");
    if (mountId) {
        const mount = getUserMount(db, user.user_id, mountId);
        if (!mount) {
            await interaction.reply({content: "Bạn chưa có thú cưỡi này.", ephemeral: true});
            return;
        }
        await interaction.reply({
            embeds: [buildMountInfoEmbed(mount)],
            ephemeral: false,
        });
        return;
    }

    const mounts = getUserMounts(db, user.user_id);
    const {embed, components} = buildMountListEmbed(user.user_id, mounts, 0);
    await interaction.reply({
        embeds: [embed],
        components,
        ephemeral: false,
    });
}

async function handleSuDungThuCuoi(interaction, db, persist) {
    if (INFO_CHANNEL_ID && interaction.channelId !== INFO_CHANNEL_ID) {
        await interaction.reply({content: TEXT.infoChannelOnly, ephemeral: true});
        return;
    }

    const mountId = Number(interaction.options.getInteger("id", true));
    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);

    const mount = getUserMount(db, user.user_id, mountId);
    if (!mount) {
        await interaction.reply({content: "Bạn chưa có thú cưỡi này.", ephemeral: true});
        return;
    }

    const shouldUnlock = Number(mount.stats_unlocked || 0) === 0;
    const baseStats = shouldUnlock ? rollMountBaseStats() : null;

    db.run("BEGIN");
    db.run("UPDATE user_mounts SET equipped = 0 WHERE user_id = ?", [user.user_id]);
    if (shouldUnlock) {
        db.run(
            "UPDATE user_mounts SET stats_unlocked = 1, base_stats = ? WHERE user_id = ? AND mount_id = ?",
            [JSON.stringify(baseStats), user.user_id, mountId]
        );
    }
    db.run(
        "UPDATE user_mounts SET equipped = 1 WHERE user_id = ? AND mount_id = ?",
        [user.user_id, mountId]
    );
    db.run("COMMIT");
    persist();

    const refreshed = getUserMount(db, user.user_id, mountId);

    if (shouldUnlock) {
        await interaction.reply({
            embeds: [buildMountInfoEmbed(refreshed, "Đã mở chỉ số thú cưỡi")],
            ephemeral: false,
        });
        return;
    }

    const name = getMountName(mountId);
    await interaction.reply({
        content: `Đã đeo thú cưỡi **${name}**.`,
        ephemeral: false,
    });
}

async function handleDotPhaThuCuoi(interaction, db, persist) {
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

    const mount = getEquippedMount(db, user.user_id);
    if (!mount) {
        await interaction.reply({content: "Bạn chưa đeo thú cưỡi nào.", ephemeral: true});
        return;
    }

    if (Number(mount.stats_unlocked || 0) === 0) {
        await interaction.reply({
            content: "Thú cưỡi chưa mở chỉ số. Hãy dùng /sudungthucuoi trước.",
            ephemeral: true,
        });
        return;
    }

    const level = Math.max(1, Number(mount.level || 1));
    if (level < MOUNT_MAX_LEVEL) {
        await interaction.reply({
            content: `Thú cưỡi chưa đạt level 100 (hiện tại: ${level}).`,
            ephemeral: true,
        });
        return;
    }

    if (Number(user.currency || 0) < MOUNT_BREAK_COST) {
        await interaction.reply({
            content: `${TEXT.notEnoughCurrency} Cần ${formatNumber(MOUNT_BREAK_COST)} ${CURRENCY_NAME}.`,
            ephemeral: true,
        });
        return;
    }

    const success = Math.random() < MOUNT_BREAK_SUCCESS_RATE;
    const nextStar = Math.max(1, Number(mount.star || 1)) + (success ? 1 : 0);

    db.run("BEGIN");
    db.run("UPDATE users SET currency = currency - ? WHERE user_id = ?", [
        MOUNT_BREAK_COST,
        user.user_id,
    ]);
    if (success) {
        db.run(
            "UPDATE user_mounts SET star = star + 1 WHERE user_id = ? AND mount_id = ?",
            [user.user_id, mount.mount_id]
        );
    }
    db.run("COMMIT");
    persist();

    await interaction.reply({
        embeds: [
            {
                color: success ? 0x2ecc71 : 0xe74c3c,
                title: success ? "✨ Đột phá thành công!" : "💥 Đột phá thất bại",
                description:
                    `Chi phí: **${formatNumber(MOUNT_BREAK_COST)} ${CURRENCY_NAME}**\n` +
                    `Thú cưỡi: **${getMountName(Number(mount.mount_id))}**\n` +
                    `Sao hiện tại: ★${nextStar}`,
                timestamp: new Date(),
            },
        ],
        ephemeral: false,
    });
}

async function handleSuDungCo(interaction, db, persist) {
    if (INFO_CHANNEL_ID && interaction.channelId !== INFO_CHANNEL_ID) {
        await interaction.reply({content: TEXT.infoChannelOnly, ephemeral: true});
        return;
    }

    const amount = Math.max(1, Number(interaction.options.getInteger("soluong", true)));
    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);

    const mount = getEquippedMount(db, user.user_id);
    if (!mount) {
        await interaction.reply({content: "Bạn chưa đeo thú cưỡi nào.", ephemeral: true});
        return;
    }

    const level = Math.max(1, Number(mount.level || 1));
    if (level >= MOUNT_MAX_LEVEL) {
        await interaction.reply({content: "Thú cưỡi đã đạt level 100, không thể ăn cỏ nữa. Hãy /dotphathucuoi để lên sao, tỉ lệ 20%, tốn 100m ngân lượng", ephemeral: false});
        return;
    }

    const currentGrass = Math.max(0, Number(user.grass || 0));
    if (currentGrass < amount) {
        await interaction.reply({
            content: `Không đủ cỏ. Bạn đang có ${formatNumber(currentGrass)} cỏ.`,
            ephemeral: true,
        });
        return;
    }

    let newLevel = level;
    let remainingExp = Math.max(0, Number(mount.exp || 0)) + amount;
    while (newLevel < MOUNT_MAX_LEVEL && remainingExp >= MOUNT_EXP_PER_LEVEL) {
        remainingExp -= MOUNT_EXP_PER_LEVEL;
        newLevel += 1;
    }
    if (newLevel >= MOUNT_MAX_LEVEL) {
        remainingExp = 0;
    }

    db.run("BEGIN");
    db.run("UPDATE users SET grass = grass - ? WHERE user_id = ?", [amount, user.user_id]);
    db.run("UPDATE user_mounts SET level = ?, exp = ? WHERE user_id = ? AND mount_id = ?", [
        newLevel,
        remainingExp,
        user.user_id,
        mount.mount_id,
    ]);
    db.run("COMMIT");
    persist();

    const refreshed = getUserMount(db, user.user_id, mount.mount_id);
    const expLabel =
        newLevel >= MOUNT_MAX_LEVEL
            ? "Đã đạt level 100"
            : `${formatNumber(remainingExp)}/${formatNumber(MOUNT_EXP_PER_LEVEL)} exp`;

    await interaction.reply({
        embeds: [
            {
                color: 0x2ecc71,
                title: "🌿 Cho thú cưỡi ăn cỏ",
                description:
                    `Đã dùng: **${formatNumber(amount)}** cỏ\n` +
                    `Level: **${level} → ${newLevel}**\n` +
                    `EXP hiện tại: **${expLabel}**`,
                timestamp: new Date(),
            },
            buildMountInfoEmbed(refreshed, "Thú cưỡi hiện tại"),
        ],
        ephemeral: false,
    });
}

async function handleMountListButton(interaction, db, persist) {
    const customId = interaction.customId || "";
    const [prefix, action, ownerId, pageStr] = customId.split(":");
    if (prefix !== "mounts") return false;

    if (ownerId !== interaction.user.id) {
        await interaction.reply({content: "Bạn không thể dùng nút này.", ephemeral: true});
        return true;
    }

    const currentPage = Number(pageStr || 0);
    const targetPage = action === "next" ? currentPage + 1 : currentPage - 1;
    const mounts = getUserMounts(db, ownerId);
    const {embed, components} = buildMountListEmbed(ownerId, mounts, targetPage);

    await interaction.update({
        embeds: [embed],
        components,
    });
    return true;
}

async function handleTaiSan(interaction, db, persist) {
    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);

    await interaction.reply({
        ephemeral: true,
        embeds: [
            {
                color: 0xf39c12,
                title: "Tài sản",
                description: `**${formatNumber(user.currency)} ${CURRENCY_NAME}**.`,
                footer: {text: "/taisan"},
                timestamp: new Date()
            }
        ]
    });
}

async function handleHanhTrang(interaction, db, persist) {
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

    await interaction.reply({
        ephemeral: false,
        embeds: [
            {
                color: 0x2ecc71,
                title: "Hành trang",
                description:
                    `Ngân lượng: **${formatNumber(user.currency)} ${CURRENCY_NAME}**\n` +
                    `Cỏ: **${formatNumber(user.grass || 0)}**`,
                footer: {text: "/hanhtrang"},
                timestamp: new Date()
            }
        ]
    });
}

async function handleTopDaiGia(interaction, db, persist) {
    if (LEADERBOARD_CHANNEL_ID && interaction.channelId !== LEADERBOARD_CHANNEL_ID) {
        await interaction.reply({content: TEXT.leaderboardChannelOnly, ephemeral: true});
        return;
    }

    const stmt = db.prepare(
        "SELECT user_id, base_name, currency FROM users ORDER BY currency DESC LIMIT 10"
    );
    const rows = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
            user_id: row.user_id,
            base_name: row.base_name,
            currency: Number(row.currency || 0),
        });
    }
    stmt.free();

    const lines = rows.map((row, idx) =>
        `${idx + 1}. <@${row.user_id}> | **${formatNumber(row.currency)} ${CURRENCY_NAME}**`
    );

    await interaction.reply({
        embeds: [
            {
                color: 0xf1c40f,
                title: "Top Đại Gia",
                description: lines.length ? lines.join("\n") : "Chưa có dữ liệu.",
                timestamp: new Date()
            }
        ]
    });
}

async function handleTopCaoThu(interaction, db, persist) {
    if (LEADERBOARD_CHANNEL_ID && interaction.channelId !== LEADERBOARD_CHANNEL_ID) {
        await interaction.reply({content: TEXT.leaderboardChannelOnly, ephemeral: true});
        return;
    }

    const stmt = db.prepare(
        "SELECT user_id, base_name, level, exp FROM users ORDER BY level DESC, exp DESC LIMIT 10"
    );
    const rows = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
            user_id: row.user_id,
            base_name: row.base_name,
            level: Number(row.level || 0),
            exp: Number(row.exp || 0),
        });
    }
    stmt.free();

    const lines = rows.map((row, idx) =>
        `${idx + 1}. <@${row.user_id}> | Exp ${formatNumber(row.exp)}`
    );

    await interaction.reply({
        embeds: [
            {
                color: 0x3498db,
                title: "Top Cao Thủ",
                description: lines.length ? lines.join("\n") : "Chưa có dữ liệu.",
                timestamp: new Date()
            }
        ]
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
                title: "⛏️ Đào mỏ",
                description:
                    `Đã đào **${available}** lượt và nhận **${formatNumber(total)} ${CURRENCY_NAME}**.\n` +
                    (lines ? `\n${lines}` : ""),
                footer: {text: `/daomo`},
                timestamp: new Date()
            }
        ]
    });
}

async function handleChanLe(interaction, db, persist, allIn = false) {
    if (CHANLE_CHANNEL_ID && interaction.channelId !== CHANLE_CHANNEL_ID) {
        await interaction.reply({content: TEXT.chanLeChannelOnly, ephemeral: true});
        return;
    }

    const choice = interaction.options.getString("chon", true); // "chan" or "le"
    const member = await interaction.guild.members.fetch(interaction.user.id);

    let user = getUser(db, member.id);
    if (!user) {
        user = createUser(db, persist, member.id, getBaseNameFromMember(member), Date.now());
    }

    user = applyPassiveExpForUser(db, persist, user);

    const currentCurrency = Number(user.currency || 0);

    // Lấy casino state trước để xác định betAmount cho allIn
    const casinoState = await casinoService.ensureOwnerStillValid(interaction, db, persist);

    let betAmount;
    if (allIn) {
        // Nếu có chủ sòng và có max, thì lấy min giữa số dư và max
        if (casinoState.ownerId && casinoState.maxChanLe) {
            betAmount = Math.min(currentCurrency, casinoState.maxChanLe);
        } else {
            betAmount = currentCurrency;
        }
    } else {
        betAmount = Number(interaction.options.getInteger("cuoc", true));
    }

    if (betAmount <= 0 || currentCurrency <= 0) {
        await interaction.reply({content: TEXT.noBalance, ephemeral: true});
        return;
    }

    if (!allIn && betAmount > currentCurrency) {
        await interaction.reply({content: TEXT.notEnoughCurrency, ephemeral: true});
        return;
    }

    if (casinoState.ownerId && casinoState.ownerId === user.user_id) {
        await interaction.reply({content: "Chủ Sòng không được tự chơi.", ephemeral: true});
        return;
    }
    if (!allIn && casinoState.ownerId && casinoState.maxChanLe && betAmount > casinoState.maxChanLe) {
        await interaction.reply({content: `Cược tối đa: ${formatNumber(casinoState.maxChanLe)} ${CURRENCY_NAME}.`, ephemeral: true});
        return;
    }

    const now = Date.now();

    const playedBefore = Number(user.chanle_played || 0);
    const winsBefore = Number(user.chanle_won || 0);

    const result = rollChanLe();
    const isWin = result === choice;
    const payout = isWin ? Math.floor(betAmount * CHANLE_PAYOUT_RATE) : 0;

    // Deduct bet and update play/win counts
    db.run(
        "UPDATE users SET currency = currency - ?, chanle_played = chanle_played + 1, chanle_won = chanle_won + ? WHERE user_id = ?",
        [betAmount, isWin ? 1 : 0, user.user_id]
    );

    if (payout > 0) {
        db.run("UPDATE users SET currency = currency + ? WHERE user_id = ?", [payout, user.user_id]);
    }
    persist();

    const settlement = casinoService.applyChanLeSettlement(db, persist, {
        playerId: user.user_id,
        betAmount,
        payout,
        isWin,
    });

    saveChanLeResult(db, persist, result, now);
    const history = getChanLeHistory(db);
    const chartBuffer = await buildChanLeChartImage(history);

    const net = isWin ? payout - betAmount : -betAmount;
    const balanceAfter = currentCurrency - betAmount + payout;
    const resultLabel = result === "chan" ? "Chẵn" : "Lẻ";
    const choiceLabel = choice === "chan" ? "Chẵn" : "Lẻ";
    const played = playedBefore + 1;
    const wins = winsBefore + (isWin ? 1 : 0);
    const winRate = played > 0 ? ((wins / played) * 100).toFixed(1) : "0.0";

    await interaction.reply({
        embeds: [
            {
                color: isWin ? 0x2ecc71 : 0xe74c3c,
                title: `🎲 Kết quả: ${resultLabel} • Bạn chọn: ${choiceLabel}`,
                description:
                    (isWin
                        ? `✅ Thắng! Nhận lại **${formatNumber(payout)} ${CURRENCY_NAME}**.`
                        : `❌ Thua! Mất **${formatNumber(betAmount)} ${CURRENCY_NAME}**.`) +
                    `\nTài sản: **${formatNumber(balanceAfter)} ${CURRENCY_NAME}**.` +
                    (settlement && settlement.ownerId ? `\nChủ Sòng: <@${settlement.ownerId}>${settlement.ownerBalance !== undefined ? ` (${formatNumber(settlement.ownerBalance)} ${CURRENCY_NAME})` : ""}` : ""),
                footer: {text: `Tỉ lệ thắng: ${winRate}% (${wins}/${played})`},
                timestamp: new Date()
            }
        ],
        files: [{attachment: chartBuffer, name: "chan-le-history.png"}]
    });
}

async function handleBackup(interaction, db, persist) {
    if (ADMIN_CHANNEL_ID && interaction.channelId !== ADMIN_CHANNEL_ID) {
        await interaction.reply({content: TEXT.backupChannelOnly, ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (ADMIN_ROLE_ID && !member.roles.cache.has(ADMIN_ROLE_ID)) {
        await interaction.reply({content: "Bạn không có quyền dùng lệnh này.", ephemeral: true});
        return;
    }

    const dbPath = process.env.DB_PATH || "./data.db";
    await interaction.reply({
        content: "File DB",
        files: [{attachment: dbPath, name: "data.db"}],
        ephemeral: false,
    });
}

async function handleUpdate(interaction, db, persist) {
    if (ADMIN_CHANNEL_ID && interaction.channelId !== ADMIN_CHANNEL_ID) {
        await interaction.reply({ content: "Error.", ephemeral: true });
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (ADMIN_ROLE_ID && !member.roles.cache.has(ADMIN_ROLE_ID)) {
        await interaction.reply({ content: "Bạn không có quyền dùng lệnh này.", ephemeral: true });
        return;
    }

    await interaction.reply({ content: "🔄 Đang pull code...", ephemeral: false });

    const logChannel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
    if (!logChannel) return;

    exec("git pull", { cwd: __dirname }, async (error, stdout, stderr) => {
        if (error) {
            const errorEmbed = {
                color: 0xe74c3c,
                title: "❌ Error",
                description: `\`\`\`\n${stderr || error.message}\n\`\`\``,
                timestamp: new Date().toISOString(),
            };

            await logChannel.send({ embeds: [errorEmbed] });
            return;
        }

        exec(
            'git log ORIG_HEAD..HEAD --pretty=format:"%s|||%an"',
            { cwd: __dirname },
            async (logErr, logStdout) => {
                let description = "";

                if (!logStdout?.trim()) {
                    description = "Không có commit mới.";
                } else {
                    const lines = logStdout.split("\n");

                    const commitsByAuthor = {};

                    for (const line of lines) {
                        const [message, author] = line.split("|||");
                        if (!commitsByAuthor[author]) {
                            commitsByAuthor[author] = [];
                        }
                        commitsByAuthor[author].push(message);
                    }

                    for (const author in commitsByAuthor) {
                        description += `**👤 ${author}**\n`;
                        for (const msg of commitsByAuthor[author]) {
                            description += `• ${msg}\n`;
                        }
                        description += "\n";
                    }
                }

                const successEmbed = {
                    color: 0x2ecc71,
                    title: "✅ Success",
                    description,
                    timestamp: new Date().toISOString(),
                };

                await logChannel.send({ embeds: [successEmbed] });

                // Restart bot
                const batPath = path.join(__dirname, "z-index.bat");
                const child = spawn("cmd.exe", ["/c", batPath], {
                    detached: true,
                    stdio: "ignore",
                    cwd: __dirname,
                });
                child.unref();

                setTimeout(() => process.exit(0), 1000);
            }
        );
    });
}

async function handleBackupEnv(interaction) {
    if (ADMIN_CHANNEL_ID && interaction.channelId !== ADMIN_CHANNEL_ID) {
        await interaction.reply({content: "Error.", ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (ADMIN_ROLE_ID && !member.roles.cache.has(ADMIN_ROLE_ID)) {
        await interaction.reply({content: "Bạn không có quyền dùng lệnh này.", ephemeral: true});
        return;
    }

    const envPath = path.join(__dirname, ".env");
    await interaction.reply({
        content: "File .env",
        files: [{attachment: envPath, name: ".env"}],
        ephemeral: false,
    });
}

async function handleUploadEnv(interaction) {
    if (ADMIN_CHANNEL_ID && interaction.channelId !== ADMIN_CHANNEL_ID) {
        await interaction.reply({content: "Error.", ephemeral: true});
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (ADMIN_ROLE_ID && !member.roles.cache.has(ADMIN_ROLE_ID)) {
        await interaction.reply({content: "Bạn không có quyền dùng lệnh này.", ephemeral: true});
        return;
    }

    const attachment = interaction.options.getAttachment("file", true);

    try {
        const response = await fetch(attachment.url);
        const content = await response.text();

        const envPath = path.join(__dirname, ".env");
        fs.writeFileSync(envPath, content, "utf8");

        await interaction.reply({content: "Đã cập nhật file .env thành công!", ephemeral: false});
    } catch (error) {
        console.error("Upload env error:", error);
        await interaction.reply({content: `Lỗi: ${error.message}`, ephemeral: true});
    }
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

function rollChanLe() {
    return Math.random() < 0.5 ? "chan" : "le";
}

function saveChanLeResult(db, persist, result, createdAt) {
    db.run(
        "INSERT INTO chanle_history (result, created_at) VALUES (?, ?)",
        [result, createdAt]
    );
    db.run(
        `DELETE FROM chanle_history WHERE id NOT IN (
            SELECT id FROM chanle_history ORDER BY id DESC LIMIT 20
        )`
    );
    persist();
}

function getChanLeHistory(db) {
    const stmt = db.prepare(
        "SELECT result FROM chanle_history ORDER BY id DESC LIMIT 20"
    );
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject().result);
    }
    stmt.free();
    return rows.reverse();
}

function scheduleAutoBackup(client) {
    if (!ADMIN_CHANNEL_ID) return;
    runAutoBackup(client);
    setInterval(() => runAutoBackup(client), AUTO_BACKUP_INTERVAL_MS);
}

async function runAutoBackup(client) {
    if (!ADMIN_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(ADMIN_CHANNEL_ID);
        if (!channel) return;
        const dbPath = process.env.DB_PATH || "./data.db";
        const envPath = path.join(__dirname, ".env");
        await channel.send({
            content: "Backup tự động: data.db",
            files: [{attachment: dbPath, name: "data.db"}],
        });
        await channel.send({
            content: "Backup tự động: .env",
            files: [{attachment: envPath, name: ".env"}],
        });
    } catch (error) {
        console.error("Auto backup error:", error);
    }
}
