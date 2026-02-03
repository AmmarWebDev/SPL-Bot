import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { models } from "../../models/leagues.model.js";

export default {
  data: new SlashCommandBuilder()
    .setName("record-stats")
    .setDescription("Record stats from a message URL")
    .addStringOption((opt) =>
      opt
        .setName("url")
        .setDescription("Message link to parse stats from")
        .setRequired(true)
    ),

  name: "record-stats",

  async run({ message, interaction, autoConfirm = false } = {}) {
    const ctx = interaction ?? message;

    const allowedUser = "759869571632332851";
    const userId = interaction ? interaction.user.id : message?.author?.id;
    if (userId !== allowedUser) {
      const replyOpt = interaction
        ? { content: "❌ Not allowed.", ephemeral: true }
        : { content: "❌ Not allowed." };
      return interaction
        ? interaction.reply(replyOpt)
        : message?.reply?.(replyOpt);
    }

    // ---- FORCE FLAG (PREFIX ONLY) ----
    const force =
      !interaction &&
      typeof message?.content === "string" &&
      message.content.includes("--force");

    const url = interaction
      ? interaction.options.getString("url")
      : (message?.content?.split(" ").find((p) => p.startsWith("http")) || "")
          .trim();

    if (!url) {
      return interaction
        ? interaction.reply({
            content: "❌ Usage: `/record-stats <message URL>`",
            ephemeral: true,
          })
        : message?.reply?.(
            "❌ Usage: `:?record-stats <message URL> [--force]`"
          );
    }

    try {
      await handleRecordStats(url, ctx, interaction, {
        autoConfirm,
        force,
      });
    } catch (err) {
      console.error("❌ Error in recordStats.run:", err);
      if (interaction) {
        await interaction.reply({
          content: "❌ Failed to process.",
          ephemeral: true,
        });
      } else {
        await message?.reply?.("❌ Failed to process.");
      }
    }
  },
};

// ---------- MAIN HANDLER ----------
async function handleRecordStats(
  url,
  ctx,
  interaction,
  { autoConfirm = false, force = false } = {}
) {
  const match = url.match(
    /discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/
  );
  if (!match) {
    return interaction
      ? interaction.reply({ content: "❌ Invalid message URL.", ephemeral: true })
      : ctx.reply("❌ Invalid message URL.");
  }

  const [, channelId, messageId] = match;
  const client = interaction ? interaction.client : ctx.client;
  const channel = await client.channels.fetch(channelId);
  const fetchedMessage = await channel.messages.fetch(messageId);
  const channelName = fetchedMessage.channel.name.toLowerCase();

  // ---- REACTION-BASED DUPLICATE CHECK ----
  if (!force) {
    try {
      const checkReaction = fetchedMessage.reactions.cache.find(
        (r) => r.emoji?.name === "✅"
      );
      if (checkReaction) {
        let alreadyRecorded = false;
        if (checkReaction.me) alreadyRecorded = true;
        else {
          const users = await checkReaction.users.fetch().catch(() => null);
          if (users && client.user?.id && users.has(client.user.id))
            alreadyRecorded = true;
        }
        if (alreadyRecorded) {
          return interaction
            ? interaction.reply({
                content:
                  "❌ This message has already been recorded — bot reaction detected. Use `--force` to override.",
                ephemeral: true,
              })
            : ctx.reply(
                "❌ This message has already been recorded — bot reaction detected. Use `--force` to override."
              );
        }
      }
    } catch (err) {
      console.warn("⚠️ Reaction-check failed, continuing:", err);
    }
  }

  const targetLeague = Object.keys(models).find((k) =>
    channelName.includes(k)
  );
  if (!targetLeague) {
    return interaction
      ? interaction.reply({ content: "❌ Unknown channel.", ephemeral: true })
      : ctx.reply("❌ Unknown channel.");
  }

  const players = await parsePlayerStats(fetchedMessage);
  if (!players.length) {
    return interaction
      ? interaction.reply({
          content: "❌ No player stats found.",
          ephemeral: true,
        })
      : ctx.reply("❌ No player stats found.");
  }

  // Create payload for database
  const requestPayload = players.map((p) => ({
    userId: p.userId,
    goals: p.goals || 0,
    assists: p.assists || 0,
    cleansheets: 0, // Cleansheets ignored as requested
    teamId: p.teamId,
  }));

  // If autoConfirm is true (from bulkRecord), save directly
  if (autoConfirm) {
    const Model = models[targetLeague];
    const count = await savePayload(
      Model,
      requestPayload,
      fetchedMessage
    );
    return interaction
      ? interaction.reply({
          content: `✅ Recorded stats for ${count} players.`,
          ephemeral: true,
        })
      : ctx.reply(`✅ Recorded stats for ${count} players.`);
  }

  // ----- PREVIEW EMBED (Same format as bulkRecord) -----
  const previewEmbed = new EmbedBuilder()
    .setTitle(`📝 Match Preview — ${targetLeague.toUpperCase()}`)
    .setDescription(
      `**Message:** [View Message](${fetchedMessage.url})\n\n` +
      `**Player Stats:**\n` +
      players
        .map(
          (p, i) =>
            `**${i + 1}.** <@${p.userId}>  |  ⚽ ${p.goals || 0}  |  👟 ${p.assists || 0}`
        )
        .join("\n")
    )
    .addFields(
      { name: "Force Mode", value: force ? "✅ Enabled" : "❌ Disabled", inline: true },
      { name: "Players", value: `\`${players.length}\``, inline: true }
    )
    .setColor("Blue")
    .setFooter({
      text: force
        ? "⚠️ FORCE MODE: Duplicate check disabled"
        : "Click ✅ to confirm or ❌ to cancel",
    });

  // ----- BUTTONS FOR CONFIRMATION -----
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm")
      .setLabel("✅ Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("❌ Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const reply = interaction
    ? await interaction.reply({
        embeds: [previewEmbed],
        components: [row],
        ephemeral: true,
        fetchReply: true,
      })
    : await ctx.channel.send({ embeds: [previewEmbed], components: [row] });

  // ----- BUTTON COLLECTOR -----
  const collector = reply.createMessageComponentCollector({ time: 60000 });
  collector.on("collect", async (i) => {
    if (i.customId === "confirm") {
      const Model = models[targetLeague];
      const count = await savePayload(
        Model,
        requestPayload,
        fetchedMessage
      );
      await i.update({
        content: `✅ Recorded stats for ${count} players.`,
        components: [],
        embeds: [],
      });
    } else {
      await i.update({ content: "❌ Cancelled.", components: [], embeds: [] });
    }
  });
}

// ---------- SAVE TO DATABASE ----------
async function savePayload(Model, payload, sourceMessage) {
  let success = 0;
  for (const p of payload) {
    let player = await Model.findOne({ userId: p.userId });
    if (!player) {
      player = new Model(p);
    } else {
      player.goals += p.goals;
      player.assists += p.assists;
      // Cleansheets not incremented (ignored)
      player.teamId = p.teamId;
    }
    await player.save();
    success++;
  }

  await sourceMessage.react("✅").catch(() => {});
  return success;
}

// ---------- PARSER (Same as bulkRecord) ----------
const parsePlayerStats = async (msg) => {
  const lines = msg.content.split("\n");
  const goals = {};
  const assists = {};
  const teamRoles = [];

  for (const m of msg.content.matchAll(/<@&(\d+)>/g)) {
    teamRoles.push(m[1]);
  }

  const extractMultiplier = (line, emojiPattern) => {
    const patterns = [
      new RegExp(`(\\d+)\\s*[x×]\\s*(?:${emojiPattern})`, "i"), // 3x⚽
      new RegExp(`(?:${emojiPattern})\\s*[x×]\\s*(\\d+)`, "i"), // ⚽x3
      new RegExp(`(?:${emojiPattern})\\s*(\\d+)\\s*[x×]`, "i"), // ⚽ 3x
      new RegExp(`[x×]\\s*(\\d+)\\s*(?:${emojiPattern})`, "i"), // x3 ⚽
    ];
    for (const r of patterns) {
      const m = line.match(r);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  };

  for (const line of lines) {
    const m = line.match(/<@!?(\d+)>/);
    if (!m) continue;
    const id = m[1];

    const gCount =
      (line.match(/⚽/g) || []).length +
      (line.match(/<:Goal:\d+>/g) || []).length;

    const aCount =
      (line.match(/👟/g) || []).length +
      (line.match(/<:Assist:\d+>/g) || []).length;

    const g =
      gCount > 1
        ? gCount
        : extractMultiplier(line, "⚽|<:Goal:\\d+>") || gCount;

    const a =
      aCount > 1
        ? aCount
        : extractMultiplier(line, "👟|<:Assist:\\d+>") || aCount;

    if (g) goals[id] = (goals[id] || 0) + g;
    if (a) assists[id] = (assists[id] || 0) + a;
  }

  // Get ALL player IDs that appear anywhere in the message
  const allPlayerIds = new Set();
  
  // Add players with goals
  Object.keys(goals).forEach(id => allPlayerIds.add(id));
  // Add players with assists  
  Object.keys(assists).forEach(id => allPlayerIds.add(id));
  // Also check for any other player mentions in the message
  for (const m of msg.content.matchAll(/<@!?(\d+)>/g)) {
    allPlayerIds.add(m[1]);
  }

  const players = [];

  for (const id of allPlayerIds) {
    const member = await msg.guild.members.fetch(id).catch(() => null);
    const role = member
      ? member.roles.cache.find((r) => teamRoles.includes(r.id))
      : null;

    // Get goals and assists with explicit fallback to 0
    const playerGoals = goals[id] !== undefined ? goals[id] : 0;
    const playerAssists = assists[id] !== undefined ? assists[id] : 0;

    // Only include players who have at least one goal or assist
    if (playerGoals > 0 || playerAssists > 0) {
      players.push({
        userId: id,
        goals: playerGoals,
        assists: playerAssists,
        cleansheets: 0, // Cleansheets ignored as requested
        teamId: role?.id || null,
      });
    }
  }

  return players;
};