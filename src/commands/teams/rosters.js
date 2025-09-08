import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";

// Maximum number of players allowed per team
const MAX_PLAYERS = 35;

export default {
  data: new SlashCommandBuilder()
    .setName("rosters")
    .setDescription("Display all teams with their members count"),

  name: "rosters",

  async run({ interaction, message }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    try {
      // Fetch all teams from DB
      const teams = await teamsSchema.find({}).lean();
      if (!teams.length)
        return (message || interaction).reply(
          "❌ No teams found in the database."
        );

      // Ensure all guild members are cached to get accurate counts
      await guild.members.fetch();

      const activeTeams = [];
      const emptyTeams = [];

      for (const team of teams) {
        // Get role from cache or fetch if missing
        const role =
          guild.roles.cache.get(team.roleId) ||
          (await guild.roles.fetch(team.roleId).catch(() => null));
        if (!role) continue;

        // Count members who have this role
        const memberCount = role.members.size;
        const emoji = team.emoji || "⚽";
        const line = `${emoji} ${memberCount}/${MAX_PLAYERS} - <@&${role.id}>`;

        if (memberCount > 0) activeTeams.push(line);
        else emptyTeams.push(line);
      }

      if (!activeTeams.length && !emptyTeams.length)
        return (message || interaction).reply(
          "❌ No valid teams found in the guild."
        );

      // Build embed
      const embed = new EmbedBuilder()
        .setTitle("📊 Team Rosters")
        .setColor(0x3498db)
        .setTimestamp()
        .setFooter({ text: "SPL League" });

      if (activeTeams.length)
        embed.addFields({
          name: "Teams with players",
          value: activeTeams.join("\n"),
        });
      if (emptyTeams.length)
        embed.addFields({
          name: "Empty teams",
          value: emptyTeams.join("\n"),
        });

      // Reply
      if (interaction) await interaction.reply({ embeds: [embed] });
      else await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ Failed to fetch rosters:", err);
      return (message || interaction).reply("❌ Failed to fetch team rosters.");
    }
  },
};
