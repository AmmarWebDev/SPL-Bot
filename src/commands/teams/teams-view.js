import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";

export default {
  data: new SlashCommandBuilder()
    .setName("teams-view")
    .setDescription("View all teams"),

  name: "teams-view",

  async run({ message, interaction }) {
    const guild = message?.guild || interaction?.guild;
    if (!guild) {
      return (message || interaction).reply("❌ Could not fetch guild.");
    }

    // Fetch teams from DB
    const teams = await teamsSchema.find({});
    if (!teams.length) {
      return (message || interaction).reply("❌ No teams found.");
    }

    // Format team list
    const lines = [];
    let i = 1;

    for (const team of teams) {
      try {
        const role = await guild.roles.fetch(team.roleId);
        if (!role) continue;

        lines.push(`${i}. ${team.emoji} ${role}`);
        i++;
      } catch (err) {
        console.error("Failed to fetch role:", err);
      }
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("📋 Current Teams")
      .setDescription(lines.join("\n"))
      .setColor(0x2b2d31);

    if (message) {
      return message.reply({ embeds: [embed] });
    }
    if (interaction) {
      return interaction.reply({ embeds: [embed] });
    }
  },
};
