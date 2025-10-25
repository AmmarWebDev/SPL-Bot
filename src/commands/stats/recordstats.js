import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { models } from "../../models/leagues.model.js"; // 👈 import models

export default {
  data: new SlashCommandBuilder()
    .setName("recordstats")
    .setDescription("Record stats from a message URL")
    .addStringOption((opt) =>
      opt
        .setName("url")
        .setDescription("Message link to parse stats from")
        .setRequired(true)
    ),

  name: "recordstats",

  async run({ message, interaction }) {
    const ctx = interaction ?? message;

    // only allow specific user
    const allowedUser = "759869571632332851";
    const userId = interaction ? interaction.user.id : message.author.id;
    if (userId !== allowedUser) {
      const replyOpt = interaction
        ? { content: "❌ Not allowed.", ephemeral: true }
        : { content: "❌ Not allowed." };
      return interaction
        ? interaction.reply(replyOpt)
        : message.reply(replyOpt);
    }

    const url = interaction
      ? interaction.options.getString("url")
      : (message.content.split(" ")[1] || "").trim();
    if (!url)
      return interaction
        ? interaction.reply({
            content: "❌ Usage: `/recordstats <message URL>`",
            ephemeral: true,
          })
        : message.reply("❌ Usage: `?recordStats <message URL>`");

    try {
      await handleRecordStats(url, ctx, interaction);
    } catch (err) {
      console.error("❌ Error in recordstats.run:", err);
      if (interaction) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "❌ Failed to process.",
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "❌ Failed to process.",
            ephemeral: true,
          });
        }
      } else {
        await message.reply("❌ Failed to process.");
      }
    }
  },
};

// ---------- HELPERS ----------
async function handleRecordStats(url, ctx, interaction) {
  try {
    const match = url.match(
      /discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/
    );
    if (!match) {
      return interaction
        ? await interaction.reply({
            content: "❌ Invalid message URL.",
            ephemeral: true,
          })
        : await ctx.reply("❌ Invalid message URL.");
    }

    const [, channelId, messageId] = match;
    const client = interaction ? interaction.client : ctx.client;
    const channel = await client.channels.fetch(channelId);
    const fetchedMessage = await channel.messages.fetch(messageId);
    const channelName = fetchedMessage.channel.name.toLowerCase();

    // determine league
    let targetLeague = Object.keys(models).find((k) => channelName.includes(k));
    if (!targetLeague) {
      return interaction
        ? await interaction.reply({
            content: "❌ Unknown channel.",
            ephemeral: true,
          })
        : await ctx.reply("❌ Unknown channel.");
    }

    const players = await parsePlayerStats(fetchedMessage);
    if (players.length === 0) {
      return interaction
        ? await interaction.reply({
            content: "❌ No player stats found in message.",
            ephemeral: true,
          })
        : await ctx.reply("❌ No player stats found in message.");
    }

    const requestPayload = players.map((p) => ({
      userId: p.userId,
      goals: p.goals,
      assists: p.assists,
      cleansheets: p.cleansheets,
      teamId: p.teamId,
    }));

    const previewEmbed = new EmbedBuilder()
      .setTitle(`📝 Preview of stats — ${targetLeague.toUpperCase()}`)
      .setDescription(
        requestPayload
          .map(
            (p, i) =>
              `**${i + 1}. <@${p.userId}>**\n⚽ Goals: ${
                p.goals
              } | 👟 Assists: ${p.assists} | 🧤 Clean Sheets: ${p.cleansheets}`
          )
          .join("\n\n")
      )
      .setColor("Blue")
      .setFooter({ text: "Click ✅ to confirm or ❌ to cancel." });

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

    let previewMsg;
    if (interaction) {
      await interaction.reply({
        embeds: [previewEmbed],
        components: [row],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      previewMsg = await interaction.fetchReply();
    } else {
      previewMsg = await ctx.channel.send({
        embeds: [previewEmbed],
        components: [row],
        allowedMentions: { parse: [] },
      });
    }

    const actorId = interaction ? interaction.user.id : ctx.author.id;
    const filter = (i) =>
      ["confirm", "cancel"].includes(i.customId) && i.user.id === actorId;

    const collector = previewMsg.createMessageComponentCollector({
      filter,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.customId === "confirm") {
        let successCount = 0;
        const Model = models[targetLeague];

        for (const p of requestPayload) {
          try {
            let player = await Model.findOne({ userId: p.userId });
            if (!player) {
              player = new Model({
                userId: p.userId,
                goals: Number(p.goals) || 0,
                assists: Number(p.assists) || 0,
                cleansheets: Number(p.cleansheets) || 0,
                teamId: p.teamId,
              });
            } else {
              player.goals += Number(p.goals) || 0;
              player.assists += Number(p.assists) || 0;
              player.cleansheets += Number(p.cleansheets) || 0;
              player.teamId = p.teamId;
            }
            await player.save();
            successCount++;
          } catch (err) {
            console.error(`❌ Failed for ${p.userId}:`, err);
          }
        }

        await i.update({
          content: `✅ Recorded stats for ${successCount} players in **${targetLeague}**.`,
          components: [],
          embeds: [],
        });
      } else {
        await i.update({
          content: "❌ Cancelled.",
          components: [],
          embeds: [],
        });
      }
    });

    collector.on("end", async (collected) => {
      if (collected.size === 0) {
        try {
          if (interaction) {
            await interaction.editReply({
              content: "⌛ Timed out. Cancelled.",
              components: [],
              embeds: [],
            });
          } else {
            await previewMsg.edit({
              content: "⌛ Timed out. Cancelled.",
              components: [],
              embeds: [],
            });
          }
        } catch (err) {}
      }
    });
  } catch (err) {
    console.error("❌ Error in handleRecordStats:", err);
    return interaction
      ? interaction.reply({ content: "❌ Failed to process.", ephemeral: true })
      : ctx.reply("❌ Failed to process.");
  }
}

// ---------- STATS PARSER ----------
const parsePlayerStats = async (msg) => {
  const lines = msg.content.split("\n");
  const goals = {};
  const assists = {};
  const cleanSheets = new Set();
  const teamRoles = [];

  const teamMentionRegex = /<@&(\d+)>/g;
  for (const match of msg.content.matchAll(teamMentionRegex)) {
    teamRoles.push(match[1]);
  }

  for (const line of lines) {
    const goalMatch = line.match(/<@!?(\d+)>/);
    if (goalMatch) {
      const userId = goalMatch[1];
      const goalCount =
        (line.match(/⚽/g) || []).length +
        (line.match(/<:Goal:\d+>/g) || []).length;
      if (goalCount > 0) goals[userId] = (goals[userId] || 0) + goalCount;
    }
  }

  for (const line of lines) {
    const assistMatch = line.match(/<@!?(\d+)>/);
    if (assistMatch) {
      const userId = assistMatch[1];
      const assistCount =
        (line.match(/👟/g) || []).length +
        (line.match(/<:Assist:\d+>/g) || []).length;
      if (assistCount > 0)
        assists[userId] = (assists[userId] || 0) + assistCount;
    }
  }

  const cleanSheetRegex = /<:.*?:(\d+)> ✅/g;
  let match;
  while ((match = cleanSheetRegex.exec(msg.content)) !== null) {
    cleanSheets.add(match[1]);
  }

  const allUserIds = new Set([...Object.keys(goals), ...Object.keys(assists)]);
  const players = [];

  for (const userId of allUserIds) {
    let member;
    try {
      member = await msg.guild.members.fetch(userId);
    } catch (err) {
      if (err.code === 10007) {
        console.warn(`⚠️ User ${userId} not found in guild.`);
        // fallback to user fetch (no roles/cleansheets possible)
        await msg.client.users.fetch(userId).catch(() => null);

        players.push({
          userId,
          goals: goals[userId] || 0,
          assists: assists[userId] || 0,
          cleansheets: 0,
          teamId: null,
        });
        continue;
      } else {
        throw err;
      }
    }

    const matchingRoles = member.roles.cache.filter((role) =>
      teamRoles.includes(role.id)
    );
    const teamRole = matchingRoles.first();

    players.push({
      userId,
      goals: goals[userId] || 0,
      assists: assists[userId] || 0,
      cleansheets: teamRole && cleanSheets.has(teamRole.id) ? 1 : 0,
      teamId: teamRole?.id || null,
    });
  }

  return players;
};
