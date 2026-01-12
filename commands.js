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