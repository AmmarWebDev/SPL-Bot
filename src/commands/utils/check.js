import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("check")
    .setDescription("Checks if the bot is active"),

  name: "check",

  async run({ message, interaction }) {
    if (message) {
      return message.reply("Bot is active!");
    }
    if (interaction) {
      return interaction.reply("Bot is active!");
    }
  },
};
