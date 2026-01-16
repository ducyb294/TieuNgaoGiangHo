require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("doiten")
    .setDescription("Đổi tên mới")
    .addStringOption((option) =>
      option.setName("ten").setDescription("Tên mới").setRequired(true)
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
    .setName("baucua")
    .setDescription("Đặt cược Bầu Cua")
    .addStringOption((option) =>
      option
        .setName("linhvat")
        .setDescription("Chọn linh vật muốn cược")
        .setRequired(true)
        .addChoices(
          { name: "🐯 Cọp", value: "cop" },
          { name: "🦀 Cua", value: "cua" },
          { name: "🐟 Cá", value: "ca" },
          { name: "🦐 Tôm", value: "tom" },
          { name: "🐔 Gà", value: "ga" },
          { name: "🎃 Bầu", value: "bau" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("cuoc")
        .setDescription("Số Ngân Lượng cược cho linh vật này")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("lixi")
    .setDescription("Gửi lì xì cho mọi người")
    .addIntegerOption((option) =>
      option
        .setName("songuoi")
        .setDescription("Số người nhận")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    )
    .addIntegerOption((option) =>
      option
        .setName("nganluong")
        .setDescription("Số ngân lượng muốn chia")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("taisan")
    .setDescription("Xem nhanh tài sản"),
  new SlashCommandBuilder()
    .setName("npc")
    .setDescription("Nhận vai Chủ Sòng Bài"),
  new SlashCommandBuilder()
    .setName("huynpc")
    .setDescription("Huỷ vai Chủ Sòng Bài"),
  new SlashCommandBuilder()
    .setName("setmaxchanle")
    .setDescription("Chủ Sòng đặt mức cược tối đa chẵn lẻ")
    .addIntegerOption((option) =>
      option
        .setName("nganluong")
        .setDescription("Số Ngân Lượng tối đa mỗi lệnh chẵn lẻ")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("settaisanchusongbai")
    .setDescription("Admin đặt mức tài sản tối thiểu để nhận Chủ Sòng Bài")
    .addIntegerOption((option) =>
      option
        .setName("nganluong")
        .setDescription("Số Ngân Lượng tối thiểu")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("hamnguc")
    .setDescription("Xem chỉ số thủ vệ hầm ngục"),
  new SlashCommandBuilder()
    .setName("khieuchienhamnguc")
    .setDescription("Khiêu chiến thủ vệ trấn giữ hầm ngục để tăng level"),
  new SlashCommandBuilder()
    .setName("farmhamnguc")
    .setDescription("Bắt đầu farm bí cảnh (chỉ cần gọi 1 lần duy nhất)"),
  new SlashCommandBuilder()
    .setName("nhanthuonghamnguc")
    .setDescription("Nhận thưởng farm hầm ngục và reset thời gian tích lũy"),
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
    .setDescription("Backup"),
  new SlashCommandBuilder()
    .setName("topdaigia")
    .setDescription("Top 10 đại gia Ngân Lượng"),
  new SlashCommandBuilder()
    .setName("topcaothu")
    .setDescription("Top 10 cao thủ (level, exp)"),
  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Update (Admin only)"),
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
