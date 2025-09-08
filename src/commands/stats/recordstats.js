import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import axios from "axios";

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

    // only allow specific user (same check as original)
    const allowedUser = "759869571632332851";
    const userId = interaction ? interaction.user.id : message.author.id;
    if (userId !== allowedUser) {
      const replyOpt = interaction
        ? { content: "❌ Not allowed.", ephemeral: true }
        : { content: "❌ Not allowed." };
      return ctx.reply ? ctx.reply(replyOpt) : message.reply(replyOpt);
    }

    const url = interaction
      ? interaction.options.getString("url")
      : message.content.split(" ")[1];
    if (!url)
      return interaction
        ? interaction.reply({
            content: "❌ Usage: `/recordstats <message URL>`",
            ephemeral: true,
          })
        : message.reply("❌ Usage: `?recordStats <message URL>`");

    try {
      await handleRecordStats(url, ctx);
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

// ---------------------- helpers ----------------------
async function handleRecordStats(url, ctx) {
  try {
    const match = url.match(
      /discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/
    );
    if (!match) {
      return ctx.reply
        ? await ctx.reply({
            content: "❌ Invalid message URL.",
            ephemeral: true,
          })
        : ctx.channel.send("❌ Invalid message URL.");
    }

    const [, channelId, messageId] = match;
    const channel = await (ctx.client
      ? ctx.client.channels.fetch(channelId)
      : ctx.guild.client.channels.fetch(channelId));
    const fetchedMessage = await channel.messages.fetch(messageId);
    const channelName = fetchedMessage.channel.name.toLowerCase();

    let targetEndpoint = null;
    if (channelName.includes("cwc")) targetEndpoint = "cwc";
    else if (channelName.includes("euro")) targetEndpoint = "euros";
    else
      return ctx.reply
        ? await ctx.reply({ content: "❌ Unknown channel.", ephemeral: true })
        : ctx.channel.send("❌ Unknown channel.");

    const players = await parsePlayerStats(fetchedMessage);
    const requestPayload = players.map((p) => ({
      userId: p.userId,
      goals: p.goals,
      assists: p.assists,
      cleansheets: p.cleansheets,
      teamId: p.teamId,
    }));

    const previewText = requestPayload
      .map(
        (p, i) =>
          `${i + 1}. <@${p.userId}>\nGoals: ${p.goals}, Assists: ${
            p.assists
          }, Clean Sheets: ${p.cleansheets}`
      )
      .join("\n\n");

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

    // send preview
    let previewMsg;
    if (ctx.reply) {
      await ctx.reply({
        content:
          "📝 **Preview of stats**. Click ✅ to confirm or ❌ to cancel.\n\n" +
          previewText,
        components: [row],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      previewMsg = await ctx.fetchReply();
    } else {
      previewMsg = await ctx.channel.send({
        content:
          "📝 **Preview of stats**. Click ✅ to confirm or ❌ to cancel.\n\n" +
          previewText,
        components: [row],
        allowedMentions: { parse: [] },
      });
    }

    const msg = previewMsg;
    const filter = (i) =>
      ["confirm", "cancel"].includes(i.customId) &&
      i.user.id === (ctx.user?.id || ctx.author.id);

    const collector = msg.createMessageComponentCollector({
      filter,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.customId === "confirm") {
        let successCount = 0;
        for (const p of requestPayload) {
          try {
            await axios.post(
              `https://spl-production.up.railway.app/${targetEndpoint}`,
              p
            );
            successCount++;
          } catch (err) {
            console.error(`❌ Failed for ${p.userId}:`, err.message);
          }
        }
        await i.update({
          content: `✅ Recorded stats for ${successCount} players.`,
          components: [],
        });
      } else {
        await i.update({ content: "❌ Cancelled.", components: [] });
      }
    });

    collector.on("end", async (collected) => {
      if (collected.size === 0) {
        try {
          await msg.edit({
            content: "⌛ Timed out. Cancelled.",
            components: [],
          });
        } catch (err) {
          // ignore
        }
      }
    });
  } catch (err) {
    console.error("❌ Error in handleRecordStats:", err);
    return ctx.reply
      ? ctx.reply({ content: "❌ Failed to process.", ephemeral: true })
      : ctx.channel.send("❌ Failed to process.");
  }
}

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
    const member = await msg.guild.members.fetch(userId);
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
