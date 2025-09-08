import { SlashCommandBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";
import { logTransfer } from "../../functions/logTransfer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("sign")
    .setDescription("Sign a free agent to your team")
    .addUserOption((opt) =>
      opt
        .setName("player")
        .setDescription("The free agent to sign")
        .setRequired(true)
    ),

  name: "sign",

  async run({ interaction, message, args }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    // ===========================
    // Normalize player input
    // ===========================
    let player;
    if (interaction) {
      player = interaction.options.getUser("player");
    } else {
      if (!args.length) return message.reply("❌ Usage: `?sign @user`");
      const idMatch = args[0].match(/^<@!?(\d+)>$/);
      const userId = idMatch ? idMatch[1] : args[0];
      try {
        player = await guild.client.users.fetch(userId);
      } catch {
        return message.reply("❌ Could not fetch that player.");
      }
    }
    if (!player)
      return (message || interaction).reply("❌ Invalid player provided.");

    const member = await guild.members.fetch(player.id).catch(() => null);
    if (!member)
      return (message || interaction).reply("❌ Could not fetch that player.");

    // ===========================
    // Prevent signing bots
    // ===========================
    if (player.bot) {
      return (message || interaction).reply(
        "❌ Bots cannot be signed as players."
      );
    }

    // ===========================
    // Manager + Assistant Manager check
    // ===========================
    const managerDoc = await rolesSchema.findOne({ type: "manager" }).lean();
    const assistantDoc = await rolesSchema
      .findOne({ type: "assistant manager" })
      .lean();

    const managerRole = managerDoc
      ? await guild.roles.fetch(managerDoc.roleId).catch(() => null)
      : null;
    const assistantRole = assistantDoc
      ? await guild.roles.fetch(assistantDoc.roleId).catch(() => null)
      : null;

    const actorMember = interaction?.member || message?.member;
    if (
      !(
        (managerRole && actorMember.roles.cache.has(managerRole.id)) ||
        (assistantRole && actorMember.roles.cache.has(assistantRole.id))
      )
    ) {
      return (message || interaction).reply(
        "❌ Only managers or assistant managers can use this command."
      );
    }

    // ===========================
    // Player eligibility (verified)
    // ===========================
    const verifiedDoc =
      (await rolesSchema.findOne({ type: { $regex: /^verified$/i } }).lean()) ||
      (await rolesSchema.findOne({ type: "verified" }).lean());

    if (!verifiedDoc)
      return (message || interaction).reply("❌ Verified role not set in DB.");

    if (!member.roles.cache.has(verifiedDoc.roleId)) {
      return (message || interaction).reply("❌ Player must be verified.");
    }

    // ===========================
    // Find manager's team by roleId
    // ===========================
    let teamDoc;
    try {
      const myRoleIds = actorMember.roles.cache.map((r) => r.id);
      teamDoc = await teamsSchema
        .findOne({ roleId: { $in: myRoleIds } })
        .lean();

      if (!teamDoc) {
        const allTeams = await teamsSchema.find({}).lean();
        const summary = allTeams.map((t) => ({
          roleId: t.roleId,
          emoji: t.emoji,
        }));
        const debugMsg =
          "❌ Couldn't infer your team from your roles.\n" +
          "Manager role IDs you have: " +
          JSON.stringify(myRoleIds) +
          "\nTeams in DB (summary):\n" +
          "```\n" +
          JSON.stringify(summary, null, 2) +
          "\n```\n" +
          "Make sure your manager has the team role and that its roleId exists in the DB.";
        if (interaction)
          await interaction.reply({ content: debugMsg, ephemeral: true });
        else await message.reply(debugMsg);
        return;
      }
    } catch (e) {
      console.error("Error while finding team (by roleId):", e);
      return (message || interaction).reply(
        "❌ Error while finding team (check server logs)."
      );
    }

    const teamRole = await guild.roles.fetch(teamDoc.roleId).catch(() => null);
    if (!teamRole) {
      return (message || interaction).reply(
        "❌ Team role configured in DB was not found in this guild."
      );
    }

    // ===========================
    // Bot hierarchy checks & signing logic
    // ===========================
    const botMember =
      guild.members.me || (await guild.members.fetch(guild.client.user.id));
    const botTopPos = botMember.roles.highest.position;

    // Tolerant freeAgent lookup
    const freeAgentDoc =
      (await rolesSchema
        .findOne({ type: { $regex: /^free[_\-\s]?agent$/i } })
        .lean()) ||
      (await rolesSchema.findOne({ type: "freeAgent" }).lean()) ||
      (await rolesSchema.findOne({ type: "free agent" }).lean());

    try {
      // Remove free agent role if exists
      if (freeAgentDoc) {
        const freeAgentRole =
          guild.roles.cache.get(freeAgentDoc.roleId) ||
          (await guild.roles.fetch(freeAgentDoc.roleId).catch(() => null));
        if (freeAgentRole && member.roles.cache.has(freeAgentRole.id)) {
          if (botTopPos <= freeAgentRole.position)
            return (message || interaction).reply(
              "❌ Cannot remove freeAgent role: bot role is not high enough."
            );
          await member.roles.remove(freeAgentRole.id);
        }
      }

      // Add team role
      if (botTopPos <= teamRole.position)
        return (message || interaction).reply(
          "❌ Cannot add team role: bot role is not high enough."
        );

      await member.roles.add(teamRole.id);

      const successMsg = `✅ <@${player.id}> has been signed to <@&${teamRole.id}>!`;
      if (interaction) await interaction.reply(successMsg);
      else await message.reply(successMsg);

      const actor = interaction?.user || message?.author;
      await logTransfer(guild.client, player, teamRole, actor);
    } catch (err) {
      console.error("❌ Failed to sign player:", err);
      return (message || interaction).reply("❌ Failed to sign player.");
    }
  },
};
