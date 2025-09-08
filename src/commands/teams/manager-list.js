import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";

export default {
  data: new SlashCommandBuilder()
    .setName("manager-list")
    .setDescription("Show all teams with their managers"),

  name: "manager-list",

  async run({ interaction, message }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    try {
      const teams = await teamsSchema.find({}).lean();
      if (!teams.length)
        return (message || interaction).reply("❌ No teams found in DB.");

      const managerDoc = await rolesSchema.findOne({ type: "manager" }).lean();
      const managerRoleId = managerDoc?.roleId;

      if (!managerRoleId)
        return (message || interaction).reply("❌ Manager role not set in DB.");

      const embed = new EmbedBuilder()
        .setTitle("📋 Team Managers")
        .setColor(0x1abc9c)
        .setTimestamp()
        .setFooter({ text: "SPL League" });

      const lines = [];

      for (const team of teams) {
        const teamRole = await guild.roles.fetch(team.roleId).catch(() => null);
        if (!teamRole) continue;

        let managers = [];
        if (managerRoleId) {
          // Get members that have both manager role and the team role
          managers = teamRole.members.filter((m) =>
            m.roles.cache.has(managerRoleId)
          );
        }

        const managerMentions = managers.size
          ? managers.map((m) => `<@${m.id}>`).join(", ")
          : "No manager";

        lines.push(`⚽ <@&${teamRole.id}> — ${managerMentions}`);
      }

      if (!lines.length)
        return (message || interaction).reply(
          "❌ No valid teams or managers found in this guild."
        );

      embed.setDescription(lines.join("\n"));

      if (interaction) await interaction.reply({ embeds: [embed] });
      else await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("❌ Failed to fetch managers:", err);
      return (message || interaction).reply(
        "❌ Failed to fetch team managers."
      );
    }
  },
};
