import { SlashCommandBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";
import { logTransfer } from "../../functions/logTransfer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("demand")
    .setDescription("Release yourself from your current team"),

  name: "demand",

  async run({ interaction, message }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    const actorMember = interaction?.member || message?.member;
    if (!actorMember)
      return (message || interaction).reply(
        "❌ Could not fetch your member object."
      );

    // ===========================
    // Find player's team
    // ===========================
    const myRoleIds = actorMember.roles.cache.map((r) => r.id);
    const teamDoc = await teamsSchema
      .findOne({ roleId: { $in: myRoleIds } })
      .lean();
    if (!teamDoc)
      return (message || interaction).reply(
        "❌ You are not in a registered team."
      );

    const teamRole = await guild.roles.fetch(teamDoc.roleId).catch(() => null);
    if (!teamRole)
      return (message || interaction).reply(
        "❌ Your team role was not found in this guild."
      );

    // ===========================
    // Prepare bot member for hierarchy check
    // ===========================
    const botMember =
      guild.members.me || (await guild.members.fetch(guild.client.user.id));
    const botTopPos = botMember.roles.highest.position;

    if (botTopPos <= teamRole.position) {
      return (message || interaction).reply(
        "❌ Cannot remove your team role: bot role is not high enough in role hierarchy."
      );
    }

    // ===========================
    // Optional free agent role
    // ===========================
    const freeAgentDoc = await rolesSchema
      .findOne({ type: { $regex: /^free[_\-\s]?agent$/i } })
      .lean();
    const freeAgentRoleId = freeAgentDoc?.roleId;

    // ===========================
    // Manager & Assistant Manager roles
    // ===========================
    const managerDoc = await rolesSchema.findOne({ type: "manager" }).lean();
    const assistantDoc = await rolesSchema
      .findOne({ type: "assistant manager" })
      .lean();

    const managerRoleId = managerDoc?.roleId;
    const assistantRoleId = assistantDoc?.roleId;

    try {
      // Remove team role
      await actorMember.roles.remove(teamRole.id);

      // Remove manager & assistant manager roles
      if (managerRoleId && actorMember.roles.cache.has(managerRoleId)) {
        await actorMember.roles.remove(managerRoleId);
      }
      if (assistantRoleId && actorMember.roles.cache.has(assistantRoleId)) {
        await actorMember.roles.remove(assistantRoleId);
      }

      // Add free agent role if not present
      if (freeAgentRoleId && !actorMember.roles.cache.has(freeAgentRoleId)) {
        await actorMember.roles.add(freeAgentRoleId);
      }

      const successMsg = `✅ You have released yourself from <@&${teamRole.id}>.`;
      if (interaction) await interaction.reply(successMsg);
      else await message.reply(successMsg);

      // Log as "demand"
      const actor = interaction?.user || message?.author;
      await logTransfer(guild.client, actor, teamRole, actor, "demand");
    } catch (err) {
      console.error("❌ Failed to release self:", err);
      return (message || interaction).reply("❌ Failed to release yourself.");
    }
  },
};
