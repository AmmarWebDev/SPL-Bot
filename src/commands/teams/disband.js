import { SlashCommandBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";
import { log } from "../../functions/log.js";

export default {
  data: new SlashCommandBuilder()
    .setName("disband")
    .setDescription("Remove all members from a team")
    .addStringOption((opt) =>
      opt.setName("team").setDescription("Team name or ID").setRequired(true)
    ),

  name: "disband",

  async run({ interaction, message, args }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    const teamInput = interaction
      ? interaction.options.getString("team")
      : args[0];
    if (!teamInput)
      return (message || interaction).reply("❌ Please provide a team name.");

    // ===========================
    // Find the team in DB
    // ===========================
    const teamDoc = await teamsSchema
      .findOne({
        $or: [{ name: teamInput }, { roleId: teamInput }],
      })
      .lean();
    if (!teamDoc)
      return (message || interaction).reply("❌ Team not found in DB.");

    const teamRole = await guild.roles.fetch(teamDoc.roleId).catch(() => null);
    if (!teamRole)
      return (message || interaction).reply(
        "❌ Team role not found in this guild."
      );

    // Fetch manager & assistant manager roles
    const managerDoc = await rolesSchema.findOne({ type: "manager" }).lean();
    const assistantDoc = await rolesSchema
      .findOne({ type: "assistant manager" })
      .lean();
    const freeAgentDoc = await rolesSchema
      .findOne({ type: { $regex: /^free[_\-\s]?agent$/i } })
      .lean();

    const managerRoleId = managerDoc?.roleId;
    const assistantRoleId = assistantDoc?.roleId;
    const freeAgentRoleId = freeAgentDoc?.roleId;

    // ===========================
    // Remove all members from team
    // ===========================
    try {
      const members = teamRole.members;

      for (const [_, member] of members) {
        const rolesToRemove = [teamRole.id];
        if (managerRoleId && member.roles.cache.has(managerRoleId))
          rolesToRemove.push(managerRoleId);
        if (assistantRoleId && member.roles.cache.has(assistantRoleId))
          rolesToRemove.push(assistantRoleId);

        // Remove roles
        await member.roles.remove(rolesToRemove);

        // Add free agent if applicable
        if (freeAgentRoleId && !member.roles.cache.has(freeAgentRoleId)) {
          await member.roles.add(freeAgentRoleId);
        }

        // Log each member
        await log(
          "Team Disbanded",
          `User <@${member.id}> removed from <@&${teamRole.id}> and roles cleaned.`
        );
      }

      const successMsg = `✅ All members have been removed from <@&${teamRole.id}>.`;
      if (interaction) await interaction.reply(successMsg);
      else await message.reply(successMsg);
    } catch (err) {
      console.error("❌ Failed to disband team:", err);
      return (message || interaction).reply(
        "❌ Failed to disband the team. Check bot logs."
      );
    }
  },
};
