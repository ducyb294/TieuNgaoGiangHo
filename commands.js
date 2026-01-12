require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("doiten")
    .setDescription("Doi nickname theo dinh dang Ten - Level x")
    .addStringOption((option) =>
      option
        .setName("ten")
        .setDescription("Ten moi, khong ky tu dac biet")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("dotpha")
    .setDescription("Dot pha len level khi du exp"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Dang dang ky slash command...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Dang ky lenh thanh cong!");
  } catch (error) {
    console.error(error);
  }
})();
