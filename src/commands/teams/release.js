import { SlashCommandBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";
import { logTransfer } from "../../functions/logTransfer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("release")
    .setDescription("Release a player from your team")
    .addUserOption((opt) =>
      opt
        .setName("player")
        .setDescription("The player to release")
        .setRequired(true)
    ),

  name: "release",

  async run({ interaction, message, args }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    const invokerMember = interaction?.member || message?.member;

    // --------------------------
    // Manager or Assistant Manager role check
    // --------------------------
    const managerRolesDocs = await rolesSchema
      .find({ type: { $in: ["manager", "assistant manager"] } })
      .lean();
    if (!managerRolesDocs.length)
      return (message || interaction).reply(
        "❌ Manager or Assistant Manager role not configured in DB."
      );

    const allowedRoles = await Promise.all(
      managerRolesDocs.map(async (r) => {
        if (!r.roleId) return null;
        return (
          guild.roles.cache.get(r.roleId) ||
          (await guild.roles.fetch(r.roleId).catch(() => null))
        );
      })
    );

    const hasPermission = allowedRoles.some(
      (r) => r && invokerMember.roles.cache.has(r.id)
    );
    if (!hasPermission)
      return (message || interaction).reply(
        "❌ Only managers or assistant managers can use this command."
      );

    // --------------------------
    // Resolve target member
    // --------------------------
    let targetMember;
    if (interaction) {
      targetMember = interaction.options.getMember("player");
    } else {
      if (!args.length) return message.reply("❌ Usage: `?release <@user|id>`");
      const m = args[0].match(/^<@!?(\d+)>$/);
      const id = m ? m[1] : args[0];
      targetMember = await guild.members.fetch(id).catch(() => null);
    }
    if (!targetMember)
      return (message || interaction).reply("❌ Could not find that member.");

    // --------------------------
    // Find invoker's team
    // --------------------------
    const invokerRoleIds = invokerMember.roles.cache.map((r) => r.id);
    const myTeamDoc = await teamsSchema
      .findOne({ roleId: { $in: invokerRoleIds } })
      .lean();
    if (!myTeamDoc) {
      return (message || interaction).reply(
        "❌ You don't manage any registered team."
      );
    }

    const teamRole = await guild.roles
      .fetch(myTeamDoc.roleId)
      .catch(() => null);
    if (!teamRole) {
      return (message || interaction).reply(
        "❌ Your team role (from DB) was not found on this guild."
      );
    }

    // Ensure target is in this manager's team
    if (!targetMember.roles.cache.has(teamRole.id)) {
      return (message || interaction).reply(
        "❌ That member is not in your team."
      );
    }

    // --------------------------
    // Bot hierarchy checks
    // --------------------------
    const botMember =
      guild.members.me || (await guild.members.fetch(guild.client.user.id));
    const botTopPos = botMember.roles.highest.position;
    if (botTopPos <= teamRole.position) {
      return (message || interaction).reply(
        "❌ I can't remove the team role: my role is not high enough in the role hierarchy."
      );
    }

    // --------------------------
    // Free Agent role (optional)
    // --------------------------
    const freeAgentDoc =
      (await rolesSchema
        .findOne({ type: { $regex: /^free[_\-\s]?agent$/i } })
        .lean()) ||
      (await rolesSchema.findOne({ type: "freeAgent" }).lean()) ||
      (await rolesSchema.findOne({ type: "free agent" }).lean());

    let freeAgentRole = null;
    if (freeAgentDoc && freeAgentDoc.roleId) {
      freeAgentRole = await guild.roles
        .fetch(freeAgentDoc.roleId)
        .catch(() => null);
    } else {
      freeAgentRole =
        guild.roles.cache.find((r) =>
          r.name.toLowerCase().includes("free agent")
        ) || null;
    }

    const canAddFreeAgent = freeAgentRole && botTopPos > freeAgentRole.position;

    // --------------------------
    // Perform release
    // --------------------------
    try {
      await targetMember.roles.remove(teamRole.id);

      if (freeAgentRole && !targetMember.roles.cache.has(freeAgentRole.id)) {
        if (canAddFreeAgent) await targetMember.roles.add(freeAgentRole.id);
        else
          console.warn(
            `Bot cannot add freeAgent role (${freeAgentRole.id}) due to hierarchy. Team role removed but freeAgent not added.`
          );
      }

      const actorUser = interaction?.user || message?.author;
      const reply = `✅ <@${targetMember.id}> has been released from ${
        myTeamDoc.emoji || ""
      } <@&${teamRole.id}>.`;
      if (interaction) await interaction.reply(reply);
      else await message.reply(reply);

      // Log the release
      await logTransfer(
        guild.client,
        targetMember.user,
        teamRole,
        actorUser,
        "release"
      );
    } catch (err) {
      console.error("❌ Failed to release player:", err);
      return (message || interaction).reply("❌ Failed to release player.");
    }
  },
};
