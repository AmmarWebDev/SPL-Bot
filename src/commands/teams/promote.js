import { SlashCommandBuilder } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import rolesSchema from "../../models/roles.model.js";
import { logTransfer } from "../../functions/logTransfer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("promote")
    .setDescription("Promote one of your players to Assistant Manager")
    .addUserOption((opt) =>
      opt
        .setName("player")
        .setDescription("The player to promote")
        .setRequired(true)
    ),

  name: "promote",

  async run({ interaction, message, args }) {
    const guild = interaction?.guild || message?.guild;
    if (!guild)
      return (message || interaction).reply("❌ Could not fetch guild.");

    const actorMember = interaction?.member || message?.member;
    const actorUser = interaction?.user || message?.author;
    if (!actorMember)
      return (message || interaction).reply(
        "❌ Could not fetch your member object."
      );

    // --------------------------
    // Check manager or assistant manager role
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
      (r) => r && actorMember.roles.cache.has(r.id)
    );
    if (!hasPermission)
      return (message || interaction).reply(
        "❌ Only managers or assistant managers can use this command."
      );

    // --------------------------
    // Normalize player input
    // --------------------------
    let player;
    if (interaction) {
      player = interaction.options.getUser("player");
    } else {
      if (!args.length) return message.reply("❌ Usage: `?promote @player`");
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
    if (player.bot)
      return (message || interaction).reply("❌ Bots cannot be promoted.");

    const targetMember = await guild.members.fetch(player.id).catch(() => null);
    if (!targetMember)
      return (message || interaction).reply("❌ Could not fetch that player.");

    // --------------------------
    // Find invoker's team
    // --------------------------
    const myRoleIds = actorMember.roles.cache.map((r) => r.id);
    const teamDoc = await teamsSchema
      .findOne({ roleId: { $in: myRoleIds } })
      .lean();
    if (!teamDoc)
      return (message || interaction).reply(
        "❌ Could not find your team in the database."
      );

    const teamRole = await guild.roles.fetch(teamDoc.roleId).catch(() => null);
    if (!teamRole)
      return (message || interaction).reply("❌ Team role not found in guild.");

    // --------------------------
    // Ensure player is in this team
    // --------------------------
    if (!targetMember.roles.cache.has(teamRole.id))
      return (message || interaction).reply(
        "❌ That player is not in your team."
      );

    // --------------------------
    // Fetch assistant manager role
    // --------------------------
    const assistantDoc = await rolesSchema
      .findOne({ type: "assistant manager" })
      .lean();
    if (!assistantDoc)
      return (message || interaction).reply(
        "❌ Assistant Manager role not configured in DB."
      );

    const assistantRole = await guild.roles
      .fetch(assistantDoc.roleId)
      .catch(() => null);
    if (!assistantRole)
      return (message || interaction).reply(
        "❌ Assistant Manager role not found in guild."
      );

    // --------------------------
    // Bot hierarchy check
    // --------------------------
    const botMember =
      guild.members.me || (await guild.members.fetch(guild.client.user.id));
    const botTopPos = botMember.roles.highest.position;
    if (botTopPos <= assistantRole.position)
      return (message || interaction).reply(
        "❌ Cannot add Assistant Manager role: bot role is not high enough in role hierarchy."
      );

    // --------------------------
    // Perform promotion
    // --------------------------
    try {
      await targetMember.roles.add(assistantRole.id);

      const successMsg = `✅ <@${player.id}> has been promoted to Assistant Manager!`;
      if (interaction) await interaction.reply(successMsg);
      else await message.reply(successMsg);

      // Log promotion using **team role** instead of assistant manager
      await logTransfer(guild.client, player, teamRole, actorUser, "promotion");
    } catch (err) {
      console.error("❌ Failed to promote player:", err);
      return (message || interaction).reply("❌ Failed to promote player.");
    }
  },
};
