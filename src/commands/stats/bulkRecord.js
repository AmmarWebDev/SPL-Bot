import { EmbedBuilder } from "discord.js";
import recordStats from "./recordStats.js";

export default {
  name: "bulk-record",
  description:
    "Record stats for every match message in a given channel by calling recordStats.run() (auto-confirm).",
  syntax: "?:bulk-record <CHANNEL_URL>",

  /**
   * Flexible run signature supported:
   *  - run(client, message, args, db)
   *  - run(message, args, db)
   *  - run({ client, message, args, db })
   *  - run({ message, args, client, db })
   *  - run(message) (will parse args from message.content)
   */
  async run(...runArgs) {
    // ===== Normalize invocation =====
    let client, message, args = [], db;

    if (
      runArgs.length === 1 &&
      typeof runArgs[0] === "object" &&
      (runArgs[0].message || runArgs[0].client || runArgs[0].author)
    ) {
      // object-style
      ({ client = runArgs[0].client, message = runArgs[0].message, args = runArgs[0].args || [], db = runArgs[0].db } =
        runArgs[0]);
    } else {
      // positional-style detection
      if (runArgs.length >= 2) {
        const a0 = runArgs[0],
          a1 = runArgs[1],
          a2 = runArgs[2];
        // client, message, args, db
        if (a0 && a0.user && a1 && a1.author) {
          client = a0;
          message = a1;
          args = Array.isArray(a2) ? a2 : a2 ? [String(a2)] : [];
          db = runArgs[3];
        }
        // message, args, db  (no explicit client)
        else if (a0 && a0.author) {
          message = a0;
          args = Array.isArray(a1) ? a1 : a1 ? [String(a1)] : [];
          db = a2;
          client = message.client;
        } else {
          // fallback
          client = runArgs[0];
          message = runArgs[1];
          args = runArgs[2] || [];
          db = runArgs[3];
        }
      } else if (runArgs.length === 1) {
        // single positional: probably message
        message = runArgs[0];
        args = [];
        client = message?.client;
      }
    }

    // fallback to message.client if missing
    if (!client && message && message.client) client = message.client;

    // ensure reply context
    if (!message || !message.reply) {
      console.error("bulk-record: missing message context (can't reply). run() called with:", runArgs);
      return;
    }

    // extract args from message.content if needed
    if ((!args || args.length === 0) && message.content) {
      const parts = message.content.trim().split(/\s+/);
      if (parts.length >= 2) args = parts.slice(1);
    }

    if (!args || !args[0]) {
      return message.reply("❌ Usage: `?:bulk-record <CHANNEL_URL>` — provide a channel link.");
    }

    const channelUrl = String(args[0]);

    // extract guildId and channelId
    const chMatch =
      channelUrl.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/) ||
      channelUrl.match(/channels\/(\d+)\/(\d+)/);

    if (!chMatch) {
      return message.reply("❌ Invalid channel URL. Use: discord.com/channels/<GUILD_ID>/<CHANNEL_ID>");
    }

    const [, guildId, channelId] = chMatch;

    // helpful safety: if command was run inside a guild, ensure supplied URL belongs to it
    if (guildId && message.guild && guildId !== message.guild.id) {
      return message.reply("❌ That channel URL is for a different server than this command invocation.");
    }

    // ===== fetch guild safely =====
    let guild;
    try {
      if (guildId && message.guild && message.guild.id === guildId) {
        guild = message.guild;
      } else if (guildId && client && client.guilds) {
        guild = await client.guilds.fetch(guildId);
      } else if (message.guild) {
        guild = message.guild;
      } else {
        return message.reply(
          "❌ Could not determine guild. Make sure you ran the command inside a server or provide a proper channel URL."
        );
      }
    } catch (err) {
      console.error("Could not fetch guild:", err);
      return message.reply("❌ Could not fetch the guild from the provided URL.");
    }

    // ===== fetch channel safely =====
    let channel;
    try {
      channel = await guild.channels.fetch(channelId);
    } catch (err) {
      console.error("Could not fetch channel:", err);
      return message.reply("❌ Could not fetch that channel. Check bot permissions and the URL.");
    }
    if (!channel || !channel.isTextBased?.()) {
      return message.reply("❌ Provided channel is not a text channel.");
    }

    // check allowed user (same restriction as recordStats)
    const allowedUser = "759869571632332851";
    if ((message.author?.id) !== allowedUser) {
      return message.reply("❌ You are not allowed to run this command.");
    }

    await message.reply(`⏳ Starting bulk record for **#${channel.name}** — scanning messages...`);

    // pagination
    let before = null;
    let scanned = 0;
    let recordedMessages = 0;
    const errors = [];
    const MAX_MESSAGES = 20000;

    while (true) {
      const fetchOptions = { limit: 100 };
      if (before) fetchOptions.before = before;

      let fetched;
      try {
        fetched = await channel.messages.fetch(fetchOptions);
      } catch (err) {
        console.error("Failed to fetch messages page:", err);
        errors.push({ reason: "fetch messages error", err: String(err) });
        break;
      }
      if (!fetched || fetched.size === 0) break;

      // process oldest -> newest
      const batch = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      for (const msg of batch) {
        scanned++;
        if (scanned > MAX_MESSAGES) {
          console.warn("Reached MAX_MESSAGES cap, stopping.");
          break;
        }

        if (!msg.content) continue;

        // skip if bot already reacted with ✅ (robust)
        let already = false;
        try {
          const checkReaction = msg.reactions.cache.find((r) => r.emoji && r.emoji.name === "✅");
          if (checkReaction) {
            if (checkReaction.me) already = true;
            else if (client?.user?.id && checkReaction.users.cache.has(client.user.id)) already = true;
            else {
              const users = await checkReaction.users.fetch().catch(() => null);
              if (users && client?.user?.id && users.has(client.user.id)) already = true;
            }
          }
        } catch (err) {
          console.warn("Reaction-check failed for message", msg.id, err);
          continue; // skip to be safe
        }

        if (already) continue;

        // Build a plain fakeMessage object (avoid Object.create(message) assignment issues)
        // Provide only the fields recordStats.run() needs:
        // - content (with the message URL so recordStats parses it)
        // - client (bot client)
        // - guild (guild used above)
        // - author (the invoking user so permission check passes)
        // - channel (the original invocation channel, but recordStats will fetch the target message itself)
        // - reply: a NO-OP to avoid per-message replies during bulk runs
        const fakeMessage = {
          content: `?record-stats ${msg.url}`,
          client: client,
          guild: guild,
          author: message.author,
          channel: message.channel,
          // no-op reply — prevents recordStats from spamming the invoker for every saved message
          reply: async () => {},
        };

        try {
          // call recordStats.run() with autoConfirm true so it saves immediately and reacts ✅ on the source message
          await recordStats.run({ message: fakeMessage, interaction: undefined, autoConfirm: true });

          recordedMessages++;
        } catch (err) {
          console.error(`Failed to process message ${msg.id} via recordStats.run():`, err);
          errors.push({ msgId: msg.id, err: String(err) });
        }
      } // end batch

      if (scanned > MAX_MESSAGES) break;

      const lastMsg = batch.length ? batch[batch.length - 1] : null;
      if (lastMsg) before = lastMsg.id;
      else break;

      if (fetched.size < 100) break;
    } // end pagination

    const embed = new EmbedBuilder()
      .setTitle("Bulk Record — Summary")
      .setDescription(
        `Channel: **${channel.name}**\n` +
          `Scanned messages: **${scanned}**\n` +
          `Messages recorded (approx): **${recordedMessages}**\n` +
          `Errors: **${errors.length}**`
      )
      .setColor("Green")
      .setFooter({ text: `Processed by ${message.author?.username || "unknown"}` });

    return message.reply({ embeds: [embed] });
  },
};
