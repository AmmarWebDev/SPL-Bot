// src/commands/teams/team-add.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import teamsSchema from "../../models/teams.model.js";
import { log } from "../../functions/log.js";

export default {
  data: new SlashCommandBuilder()
    .setName("team-add")
    .setDescription("Add a new team")
    .addStringOption((opt) =>
      opt
        .setName("role")
        .setDescription("Select a role for this team")
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("emoji")
        .setDescription("Select an emoji for this team")
        .setAutocomplete(true)
        .setRequired(true)
    )
    // Slash commands restricted to admins
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  name: "team-add",

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

    let roleInput, emoji;

    // Prefix version: ?team-add <roleId|@role> <emoji>
    if (message) {
      if (args.length < 2) {
        return message.reply("❌ Usage: `?team-add <roleId|@role> <emoji>`");
      }
      [roleInput, emoji] = args;
    }

    // Slash version
    if (interaction) {
      roleInput = interaction.options.getString("role");
      emoji = interaction.options.getString("emoji");
    }

    // ===========================
    //  Validate & Normalize Role
    // ===========================
    let roleIdClean = roleInput;
    const mentionMatch = String(roleInput).match(/^<@&(\d+)>$/);
    if (mentionMatch) {
      roleIdClean = mentionMatch[1];
    }

    const role = await guild.roles.fetch(roleIdClean).catch(() => null);
    if (!role) {
      return (message || interaction).reply("❌ Invalid role ID or mention.");
    }

    // ========================
    //      Validate Emoji
    // ========================
    const emojiRegex = /^<a?:\w+:\d+>$|^[\p{Emoji}\u200d]+$/u;
    if (!emojiRegex.test(emoji)) {
      return (message || interaction).reply("❌ Invalid emoji format.");
    }

    // ========================
    //     Save to Database
    // ========================
    try {
      const created = await teamsSchema.create({ roleId: role.id, emoji });

      // Reply to invoker
      const replyText = `✅ Added team: ${emoji} ${role}`;
      if (message) {
        await message.reply(replyText);
      } else if (interaction) {
        await interaction.reply(replyText);
      }

      // =========================
      //  Logging: new team added
      // =========================
      try {
        const actor = message?.author || interaction?.user;
        const title = "New Team Added";
        const body = `${emoji} ${role} was added by ${
          actor ? actor.toString() : "Unknown"
        }. (roleId: ${role.id})`;
        await log(title, body);
      } catch (logErr) {
        console.warn("Failed to log team-add event:", logErr);
      }

      return created;
    } catch (err) {
      console.error("❌ Failed to add team:", err);
      return (message || interaction).reply("❌ Failed to save team.");
    }
  },

  // =========================
  //  Autocomplete for Slash
  // =========================
  async autocomplete({ interaction }) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "role") {
      const roles = interaction.guild.roles.cache
        .filter((r) => r.id !== interaction.guild.id) // skip @everyone
        .map((r) => ({
          name: r.name,
          value: r.id,
        }))
        .slice(0, 25); // Discord limit
      return interaction.respond(roles);
    }

    if (focused.name === "emoji") {
      const emojis = interaction.guild.emojis.cache
        .map((e) => ({
          name: e.toString(),
          value: e.toString(),
        }))
        .slice(0, 25);
      return interaction.respond(emojis);
    }
  },
};
