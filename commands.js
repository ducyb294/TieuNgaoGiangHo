require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("doiten")
    .setDescription("Đổi tên mới")
    .addStringOption((option) =>
      option
        .setName("ten")
        .setDescription("Tên mới")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("dotpha")
    .setDescription("Nâng level khi đủ exp"),
  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Xem thông tin nhân vật"),
  new SlashCommandBuilder()
    .setName("daomo")
    .setDescription("Đào mỏ linh thạch (tiêu thể lực)"),
  new SlashCommandBuilder()
    .setName("chanle")
    .setDescription("Cược linh thạch chẵn/lẻ")
    .addStringOption((option) =>
      option
        .setName("chon")
        .setDescription("Chọn chẵn hoặc lẻ")
        .setRequired(true)
        .addChoices(
          { name: "Chẵn", value: "chan" },
          { name: "Lẻ", value: "le" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("cuoc")
        .setDescription("Số linh thạch cược")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("allinchanle")
    .setDescription("All-in linh thạch vào chẵn/lẻ")
    .addStringOption((option) =>
      option
        .setName("chon")
        .setDescription("Chọn Chẵn hoặc Lẻ")
        .setRequired(true)
        .addChoices(
          { name: "Chẵn", value: "chan" },
          { name: "Lẻ", value: "le" }
        )
    ),
  new SlashCommandBuilder()
    .setName("bicanh")
    .setDescription("Xem chỉ số thủ vệ bí cảnh"),
  new SlashCommandBuilder()
    .setName("sotaithuve")
    .setDescription("Tỉ thí thủ vệ bí cảnh để tăng level"),
  new SlashCommandBuilder()
    .setName("farmbicanh")
    .setDescription("Bắt đầu farm bí cảnh (chỉ cần gọi 1 lần duy nhất)"),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Mua chỉ số trong bí cảnh"),
  new SlashCommandBuilder()
    .setName("muasll")
    .setDescription("Mua số lượng lớn chỉ số")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("Chỉ số muốn mua")
        .setRequired(true)
        .addChoices(
          { name: "ATK", value: "attack" },
          { name: "DEF", value: "defense" },
          { name: "HP", value: "health" },
          { name: "Né tránh", value: "dodge" },
          { name: "Chính xác", value: "accuracy" },
          { name: "Tỉ lệ chí mạng", value: "crit_rate" },
          { name: "Kháng chí mạng", value: "crit_resistance" },
          { name: "Xuyên giáp", value: "armor_penetration" },
          { name: "Kháng xuyên giáp", value: "armor_resistance" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("soluong")
        .setDescription("Số lượng muốn mua")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Backup file DB (chỉ admin)"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Đang đăng ký slash command...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Đăng ký lệnh thành công!");
  } catch (error) {
    console.error(error);
  }
})();
