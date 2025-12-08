import { PermissionsBitField } from "discord.js";
import Channels from "../../models/channels.model.js";

/** Clean channel name into league slug like "dfb-pokal" */
function cleanLeagueName(channelName) {
  return String(channelName || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-results$/, "")
    .replace(/^-+|-+$/g, "");
}

export default {
  name: "set-top-players",

  /**
   * run signature expects an object: { message, args }
   */
  async run(options = {}) {
    try {
      const { message } = options;
      let { args = [] } = options;

      // Enforce admin-only usage
      if (!message || !message.member) {
        return message?.reply?.("❌ This command must be run in a server channel.");
      }

      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply("❌ You need the **Administrator** permission to use this command.");
      }

      // fallback to parsing message content if args are missing
      if ((!Array.isArray(args) || args.length < 2) && message?.content) {
        const parts = message.content.trim().split(/\s+/);
        // remove the command token (first token after prefix)
        args = parts.slice(1);
      }

      if (!Array.isArray(args) || args.length < 2) {
        return message.reply(
          "❌ Usage: `:?set-top-players <RESULT_CHANNEL_URL> <TOP_PLAYERS_CHANNEL_URL>`"
        );
      }

      const [resultChannelUrl, topPlayersChannelUrl] = args;

      // Validate URLs & extract channel IDs
      const resultMatch = resultChannelUrl.match(
        /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/
      );
      const topMatch = topPlayersChannelUrl.match(
        /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/
      );

      if (!resultMatch || !topMatch) {
        return message.reply("❌ Invalid channel URL(s). Use full Discord channel links.");
      }

      const resultChannelId = resultMatch[2];
      const topChannelId = topMatch[2];

      const client = message.client;

      const resultChannel = await client.channels.fetch(resultChannelId).catch(() => null);
      const topChannel = await client.channels.fetch(topChannelId).catch(() => null);

      if (!resultChannel) return message.reply("❌ Could not fetch the results channel.");
      if (!topChannel) return message.reply("❌ Could not fetch the top players channel.");

      // Clean league name from the results channel
      const league = cleanLeagueName(resultChannel.name);
      if (!league) return message.reply("❌ Could not extract a league name from the results channel.");

      // Upsert document storing both channel URLs and league (clear, readable fields)
      await Channels.findOneAndUpdate(
        { type: "top-players", league },
        {
          type: "top-players",
          league,
          resultChannelUrl,
          topPlayersChannelUrl,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return message.reply(
        `✅ Linked league **${league}**\n• Results channel: <#${resultChannelId}>\n• Top players channel: <#${topChannelId}>`
      );
    } catch (err) {
      console.error("❌ Error in set-top-players:", err);
      return options.message?.reply?.("❌ Failed to set top players channel (see console).");
    }
  },
};
