import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import { log } from "../../functions/log.js";

export default {
  data: new SlashCommandBuilder()
    .setName("team-set-emoji")
    .setDescription("Update a team's emoji")
    .addStringOption((opt) =>
      opt
        .setName("role")
        .setDescription("Role ID or mention of the team")
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("emoji")
        .setDescription("New emoji for the team")
        .setAutocomplete(true)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  name: "team-set-emoji",

  async run({ message, args, interaction }) {
    const guild = message?.guild || interaction?.guild;
    if (!guild) {
      return (message || interaction).reply("❌ Could not fetch guild.");
    }

    // Permission check (prefix and slash)
    const member = message?.member || interaction?.member;
    if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return (message || interaction).reply(
        "❌ You need Administrator permission to use this command."
      );
    }

    // Get inputs
    let roleInput, newEmoji;
    if (message) {
      if (args.length < 2) {
        return message.reply("❌ Usage: `?team-set-emoji <roleId|@role> <emoji>`");
      }
      [roleInput, newEmoji] = args;
    } else {
      roleInput = interaction.options.getString("role");
      newEmoji = interaction.options.getString("emoji");
    }

    roleInput = String(roleInput ?? "").trim();
    newEmoji = String(newEmoji ?? "").trim();

    // Normalize mention or raw id
    const mentionMatch = roleInput.match(/^<@&(\d+)>$/);
    const roleId = mentionMatch ? mentionMatch[1] : roleInput;

    if (!/^\d{17,19}$/.test(roleId)) {
      return (message || interaction).reply("❌ Invalid role ID or mention.");
    }

    // Fetch role to ensure it exists in this guild
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      return (message || interaction).reply("❌ Role not found in this guild.");
    }

    // Validate emoji (fallback permissive check if regex engine has issues)
    const emojiRegex = /^<a?:\w+:\d+>$|^[\p{Emoji}\u200d]+$/u;
    if (!emojiRegex.test(newEmoji)) {
      // still allow basic single-char or common emoji-like strings to avoid blocking valid input
      if (!newEmoji || newEmoji.length === 0) {
        return (message || interaction).reply("❌ Invalid or empty emoji.");
      }
    }

    try {
      // Atomic update: find the team by roleId and update emoji, return the new doc
      const updated = await teamsSchema.findOneAndUpdate(
        { roleId: role.id },
        { $set: { emoji: newEmoji } },
        { new: true } // return the updated document
      );

      if (!updated) {
        // no team registered with that roleId
        return (message || interaction).reply(
          "⚠️ That team is not registered in the database."
        );
      }

      // Optional: detect no-op (same emoji)
      // If client wants to know when no actual change happened:
      // const changed = updated.emoji === newEmoji ? false : true;

      const replyText = `✅ Updated team ${role}: ${updated.emoji}`;
      if (message) await message.reply(replyText);
      else await interaction.reply(replyText);

      // Logging
      try {
        const actor = message?.author || interaction?.user;
        const title = "Team Emoji Updated";
        const body = `${role} (${role.id}) emoji was set to ${newEmoji} by ${
          actor ? actor.toString() : "Unknown"
        }.`;
        await log(title, body);
      } catch (logErr) {
        console.warn("Failed to log team-set-emoji event:", logErr);
      }

      // Return updated doc for tests / further usage
      return updated;
    } catch (err) {
      console.error("❌ Failed to update team emoji:", err);
      return (message || interaction).reply("❌ Failed to update team emoji.");
    }
  },

  // Autocomplete (same as before)
  async autocomplete({ interaction }) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "role") {
      const roles = interaction.guild.roles.cache
        .filter((r) => r.id !== interaction.guild.id)
        .map((r) => ({ name: r.name, value: r.id }))
        .slice(0, 25);
      return interaction.respond(roles);
    }
    if (focused.name === "emoji") {
      const emojis = interaction.guild.emojis.cache
        .map((e) => ({ name: e.toString(), value: e.toString() }))
        .slice(0, 25);
      return interaction.respond(emojis);
    }
  },
};
