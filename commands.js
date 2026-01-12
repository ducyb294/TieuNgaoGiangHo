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
    .setDescription("Đào mỏ linh thạch (tiêu thể lực)")
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
