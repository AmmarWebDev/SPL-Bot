// src/commands/teams/team-delete.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import { log } from "../../functions/log.js";

export default {
  data: new SlashCommandBuilder()
    .setName("team-delete")
    .setDescription("Remove a team (by role)")
    .addStringOption((opt) =>
      opt
        .setName("role")
        .setDescription("Role to remove (id or mention)")
        .setAutocomplete(true)
        .setRequired(true)
    )
    // Slash commands can be restricted natively
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  name: "team-delete",

  // Prefix + Slash command
  async run({ message, args, interaction }) {
    const guild = message?.guild || interaction?.guild;
    if (!guild) {
      return (message || interaction).reply("❌ Could not fetch guild.");
    }

    // ==========================
    // Permission Check
    // ==========================
    const member = message?.member || interaction?.member;
    if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return (message || interaction).reply(
        "❌ You need Administrator permission to use this command."
      );
    }

    let roleInput;

    // Prefix: ?team-delete <roleId|@role>
    if (message) {
      if (args.length < 1) {
        return message.reply("❌ Usage: `?team-delete <roleId|@role>`");
      }
      [roleInput] = args;
    }

    // Slash:
    if (interaction) {
      roleInput = interaction.options.getString("role");
    }

    roleInput = String(roleInput ?? "").trim();

    // Normalize mention or raw id
    const mentionMatch = roleInput.match(/^<@&(\d+)>$/);
    const roleId = mentionMatch ? mentionMatch[1] : roleInput;

    if (!/^\d{17,19}$/.test(roleId)) {
      return (message || interaction).reply("❌ Invalid role ID or mention.");
    }

    // Try to fetch role in the guild
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      return (message || interaction).reply("❌ Role not found in this guild.");
    }

    // ==========================
    // Delete from DB
    // ==========================
    try {
      const result = await teamsSchema.deleteMany({ roleId: role.id });

      if (!result || result.deletedCount === 0) {
        const replyText = `⚠️ No team found for role ${role} (roleId: ${role.id}).`;
        if (message) await message.reply(replyText);
        else await interaction.reply(replyText);
        return;
      }

      // Reply to invoker
      const replyText = `✅ Removed ${result.deletedCount} team record(s) for ${role}.`;
      if (message) await message.reply(replyText);
      else await interaction.reply(replyText);

      // Log the deletion
      try {
        const actor = message?.author || interaction?.user;
        const title = "Team Removed";
        const body = `${role} (${role.id}) was removed by ${
          actor ? actor.toString() : "Unknown"
        }. Removed ${result.deletedCount} DB record(s).`;
        await log(title, body);
      } catch (logErr) {
        console.warn("Failed to log team-delete event:", logErr);
      }

      return result;
    } catch (err) {
      console.error("❌ Failed to delete team:", err);
      return (message || interaction).reply("❌ Failed to delete team.");
    }
  },

  // Autocomplete for role option (slash)
  async autocomplete({ interaction }) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "role") return;

    const roles = interaction.guild.roles.cache
      .filter((r) => r.id !== interaction.guild.id) // skip @everyone
      .map((r) => ({
        name: r.name,
        value: r.id,
      }))
      .slice(0, 25);

    return interaction.respond(roles);
  },
};
