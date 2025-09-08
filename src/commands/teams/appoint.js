import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";
import { log } from "../../functions/log.js";

export default {
  data: new SlashCommandBuilder()
    .setName("appoint")
    .setDescription("Appoint a member as a manager of a team")
    .addUserOption((opt) =>
      opt
        .setName("member")
        .setDescription("The member to appoint")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("team")
        .setDescription("Select the team role")
        .setAutocomplete(true)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  name: "appoint",

  async run({ message, args, interaction }) {
    const guild = message?.guild || interaction?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    const memberInvoker = message?.member || interaction?.member;
    if (!memberInvoker?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return (message || interaction).reply(
        "❌ You need Administrator permission to use this command."
      );
    }

    // -----------------------
    // Parse inputs
    // -----------------------
    let target, roleInput;
    if (message) {
      if (args.length < 2) {
        return message.reply(
          "❌ Usage: `?appoint <@member|id> <@teamRole|roleId>`"
        );
      }
      const [memberArg, teamArg] = args;
      const mentionMatch = memberArg.match(/^<@!?(\d+)>$/);
      const targetId = mentionMatch ? mentionMatch[1] : memberArg;
      target = await guild.members.fetch(targetId).catch(() => null);
      roleInput = teamArg;
    } else {
      target = interaction.options.getMember("member");
      roleInput = interaction.options.getString("team");
    }

    if (!target)
      return (message || interaction).reply("❌ Could not find that member.");

    // disallow bots
    if (target.user?.bot)
      return (message || interaction).reply("❌ Bots cannot be appointed.");

    // -----------------------
    // Normalize & fetch team role
    // -----------------------
    const roleMentionMatch = String(roleInput).match(/^<@&(\d+)>$/);
    const roleId = roleMentionMatch ? roleMentionMatch[1] : roleInput;
    const teamRole = await guild.roles.fetch(roleId).catch(() => null);
    if (!teamRole)
      return (message || interaction).reply("❌ Invalid team role.");

    // -----------------------
    // DB validations: team registered?
    // -----------------------
    const teamDoc = await teamsSchema.findOne({ roleId: teamRole.id }).lean();
    if (!teamDoc) {
      return (message || interaction).reply(
        "❌ That team is not registered in the database."
      );
    }

    // -----------------------
    // Manager role (to add to target)
    // -----------------------
    const managerRoleDoc = await rolesSchema
      .findOne({ type: "manager" })
      .lean();
    if (!managerRoleDoc)
      return (message || interaction).reply(
        "❌ Manager role is not configured in the database."
      );
    const managerRole = await guild.roles
      .fetch(managerRoleDoc.roleId)
      .catch(() => null);
    if (!managerRole)
      return (message || interaction).reply("❌ Manager role not found.");

    // -----------------------
    // Deny if target already in any registered team
    // -----------------------
    const targetRoleIds = target.roles.cache.map((r) => r.id);
    const existingTeam = await teamsSchema
      .findOne({ roleId: { $in: targetRoleIds } })
      .lean();
    if (existingTeam) {
      return (message || interaction).reply(
        `❌ This member is already in a registered team (roleId: ${existingTeam.roleId}). Remove that team role first.`
      );
    }

    // -----------------------
    // Find verified role (tolerant)
    // -----------------------
    let verifiedDoc = await rolesSchema
      .findOne({ type: { $regex: /^verified$/i } })
      .lean();
    if (!verifiedDoc) {
      // fallback: try to find role by name
      const maybeVerified = guild.roles.cache.find((r) =>
        r.name.toLowerCase().includes("verified")
      );
      if (maybeVerified) verifiedDoc = { roleId: maybeVerified.id };
    }
    if (!verifiedDoc)
      return (message || interaction).reply(
        "❌ Verified role is not configured or not found on this guild."
      );

    // Check target has Verified
    if (!target.roles.cache.has(verifiedDoc.roleId)) {
      return (message || interaction).reply(
        "❌ Member must have the Verified role."
      );
    }

    // -----------------------
    // Free agent is optional — tolerant lookup
    // -----------------------
    const freeAgentDoc =
      (await rolesSchema
        .findOne({ type: { $regex: /^free[_\-\s]?agent$/i } })
        .lean()) || (await rolesSchema.findOne({ type: "freeAgent" }).lean());

    // try fallback by role name if DB doesn't have it
    let freeAgentRole = null;
    if (freeAgentDoc && freeAgentDoc.roleId) {
      freeAgentRole = await guild.roles
        .fetch(freeAgentDoc.roleId)
        .catch(() => null);
    } else {
      // fallback: find by name containing "free agent"
      freeAgentRole =
        guild.roles.cache.find((r) =>
          r.name.toLowerCase().includes("free agent")
        ) || null;
    }

    // -----------------------
    // Hierarchy checks (bot must be able to add/remove roles)
    // -----------------------
    const botMember =
      guild.members.me || (await guild.members.fetch(guild.client.user.id));
    const botTopPos = botMember.roles.highest.position;

    const rolesToCheck = [managerRole, teamRole];
    // include freeAgentRole if we're planning to remove it (and it exists on target)
    if (freeAgentRole && target.roles.cache.has(freeAgentRole.id))
      rolesToCheck.push(freeAgentRole);

    for (const r of rolesToCheck) {
      if (!r) continue;
      if (botTopPos <= r.position) {
        return (message || interaction).reply(
          `❌ I don't have sufficient role hierarchy to modify role **${r.name}**. Move my role higher and try again.`
        );
      }
    }

    // -----------------------
    // Apply role changes
    // -----------------------
    try {
      // Add manager role
      await target.roles.add(managerRole.id);
      // Add team role
      await target.roles.add(teamRole.id);

      // Remove free agent role if it exists and the member actually has it
      if (freeAgentRole && target.roles.cache.has(freeAgentRole.id)) {
        await target.roles.remove(freeAgentRole.id);
      }

      const replyMsg = `✅ ${target} has been appointed as Manager of ${
        teamDoc.emoji || ""
      } ${teamRole}`;
      if (message) await message.reply(replyMsg);
      else await interaction.reply(replyMsg);

      // Logging
      try {
        const actor = message?.author || interaction?.user;
        const title = "Member Appointed as Manager";
        const body = `${target} was appointed to ${
          teamDoc.emoji || ""
        } ${teamRole} by ${actor ? actor.toString() : "Unknown"}. (roleId: ${
          teamRole.id
        })`;
        await log(title, body);
      } catch (logErr) {
        console.warn("Failed to log appoint event:", logErr);
      }
    } catch (err) {
      console.error("❌ Failed to appoint member:", err);
      return (message || interaction).reply("❌ Failed to appoint member.");
    }
  },

  // -----------------------
  // Autocomplete
  // -----------------------
  async autocomplete({ interaction }) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "team") {
      const guild = interaction.guild;
      const teams = await teamsSchema.find({}).limit(25).lean();
      // Map to include role name if possible
      const choices = await Promise.all(
        teams.map(async (t) => {
          let display = t.roleId;
          try {
            const role = await guild.roles.fetch(t.roleId);
            if (role) display = `${t.emoji ? t.emoji + " " : ""}${role.name}`;
          } catch {}
          return { name: display, value: t.roleId };
        })
      );
      return interaction.respond(choices);
    }
  },
};
