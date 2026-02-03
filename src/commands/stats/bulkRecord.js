import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { models } from "../../models/leagues.model.js";

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
        cleansheets: 0, // Always 0 since cleansheets are ignored
        teamId: role?.id || null,
      });
    }
  }

  return players;
};

export default {
  name: "bulk-record",
  description: "Record stats for every match message in a given channel (preview + pagination).",
  syntax: "?:bulk-record <CHANNEL_URL> [--force]",

  async run({ message, args = [] }) {
    const client = message.client;
    
    // Check permissions
    if (message.author.id !== "759869571632332851") {
      return message.reply("❌ You are not allowed.");
    }

    if (!args.length) {
      return message.reply("❌ Usage: `?:bulk-record <CHANNEL_URL> [--force]`");
    }

    const force = args.includes("--force");
    const channelUrl = args.find((a) => !a.startsWith("--"));
    
    // Extract channel ID from URL
    const match = channelUrl?.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/);
    if (!match) {
      return message.reply("❌ Invalid channel URL. Format: https://discord.com/channels/GUILD_ID/CHANNEL_ID");
    }

    const [, channelId] = match;
    
    // Get channel
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return message.reply("❌ Not a text channel or channel not found.");
    }

    const loadingMsg = await message.reply(`⏳ Loading messages in **#${channel.name}**${force ? " (FORCE MODE)" : ""}...`);

    // ===== Fetch messages =====
    let allMessages = [];
    let lastId = null;
    const MAX_MESSAGES = 1000; // Reduced for safety

    while (allMessages.length < MAX_MESSAGES) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetched = await channel.messages.fetch(options).catch(() => new Map());
      if (fetched.size === 0) break;

      const messagesArray = Array.from(fetched.values());
      allMessages.push(...messagesArray);
      
      lastId = messagesArray[messagesArray.length - 1].id;
      
      if (fetched.size < 100) break;
    }

    if (allMessages.length === 0) {
      return loadingMsg.edit("⚠️ No messages found.");
    }

    // Sort by oldest first
    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // ===== Parse messages and get previews =====
    const previews = [];
    
    for (const msg of allMessages) {
      try {
        // Skip messages that don't have player mentions
        if (!msg.content.includes("<@") && !msg.content.match(/[⚽👟]/)) {
          continue;
        }

        // Get channel name for league detection
        const channelName = msg.channel.name.toLowerCase();
        const targetLeague = Object.keys(models).find((k) =>
          channelName.includes(k)
        );
        
        if (!targetLeague) {
          continue;
        }

        // Parse player stats
        const players = await parsePlayerStats(msg);
        if (players.length === 0) {
          continue;
        }

        // Check for existing reaction if not force mode
        if (!force) {
          try {
            const checkReaction = msg.reactions.cache.find(
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
                continue; // Skip already recorded messages
              }
            }
          } catch (err) {
            console.warn("⚠️ Reaction-check failed for message:", msg.id, err);
          }
        }

        // Create preview
        const preview = {
          url: msg.url,
          message: msg,
          players: players,
          league: targetLeague,
          force: force
        };

        previews.push(preview);
        
      } catch (error) {
        console.error(`Error processing message ${msg.id}:`, error);
        continue;
      }
    }

    if (previews.length === 0) {
      return loadingMsg.edit("⚠️ No valid match stats found in messages.");
    }

    // ===== Pagination interface =====
    let currentPage = 0;
    
    const buildEmbed = (page) => {
      const preview = previews[page];
      
      // Compact format with pipeline separator and good spacing
      const playerList = preview.players
        .map(
          (p, i) => {
            const goals = p.goals || 0;
            const assists = p.assists || 0;
            return `**${i + 1}.** <@${p.userId}>  |  ⚽ ${goals}  |  👟 ${assists}`;
          }
        )
        .join("\n");

      return new EmbedBuilder()
        .setTitle(`📝 Match ${page + 1}/${previews.length} — ${preview.league.toUpperCase()}`)
        .setDescription(
          `**Message:** [View Message](${preview.url})\n\n**Player Stats:**\n${playerList}`
        )
        .addFields(
          { name: "Force Mode", value: preview.force ? "✅ Enabled" : "❌ Disabled", inline: true },
          { name: "Players", value: `\`${preview.players.length}\``, inline: true }
        )
        .setColor(0x3498db)
        .setFooter({ 
          text: `Scanned: ${allMessages.length} messages • Found: ${previews.length} matches` 
        });
    };

    const buildComponents = (page) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev")
          .setLabel("◀")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId("next")
          .setLabel("▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === previews.length - 1),
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel("❌ Cancel")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("submit")
          .setLabel("✅ Submit All")
          .setStyle(ButtonStyle.Success)
      );
    };

    // Edit the loading message to show the first page (this removes the loading text)
    await loadingMsg.edit({ 
      content: "", // Clear the loading text
      embeds: [buildEmbed(currentPage)], 
      components: [buildComponents(currentPage)] 
    });

    const collector = loadingMsg.createMessageComponentCollector({ 
      time: 5 * 60 * 1000 
    });

    collector.on("collect", async (interaction) => {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ 
          content: "❌ You cannot use these buttons.", 
          ephemeral: true 
        });
      }

      switch (interaction.customId) {
        case "prev":
          currentPage = Math.max(0, currentPage - 1);
          await interaction.update({ 
            embeds: [buildEmbed(currentPage)], 
            components: [buildComponents(currentPage)] 
          });
          break;

        case "next":
          currentPage = Math.min(previews.length - 1, currentPage + 1);
          await interaction.update({ 
            embeds: [buildEmbed(currentPage)], 
            components: [buildComponents(currentPage)] 
          });
          break;

        case "cancel":
          collector.stop("cancelled");
          await interaction.update({ 
            content: "❌ Bulk record cancelled.", 
            components: [], 
            embeds: [] 
          });
          break;

        case "submit":
          collector.stop("submitted");
          
          // Show processing message - clear embed and show text
          await interaction.update({ 
            content: `⏳ Recording stats for ${previews.length} matches...`, 
            components: [], 
            embeds: [] 
          });

          let successCount = 0;
          let failedCount = 0;
          
          // Process each message
          for (const preview of previews) {
            try {
              const Model = models[preview.league];
              const payload = preview.players.map(p => ({
                userId: p.userId,
                goals: p.goals || 0,
                assists: p.assists || 0,
                cleansheets: 0, // Cleansheets ignored as requested
                teamId: p.teamId
              }));

              // Save each player
              for (const p of payload) {
                let player = await Model.findOne({ userId: p.userId });
                if (!player) {
                  player = new Model(p);
                } else {
                  player.goals += p.goals;
                  player.assists += p.assists;
                  // Cleansheets not incremented
                  player.teamId = p.teamId;
                }
                await player.save();
              }

              // Add reaction to source message
              await preview.message.react("✅").catch(() => {});
              successCount++;
              
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 500));
              
            } catch (error) {
              console.error(`Failed to process ${preview.url}:`, error);
              failedCount++;
            }
          }

          await loadingMsg.edit({
            content: `✅ **Bulk Record Completed!**\n\n**Results:**\n• ✅ Successfully recorded: ${successCount}\n• ❌ Failed: ${failedCount}\n• 📊 Total matches: ${previews.length}`,
            components: [],
            embeds: []
          });
          break;
      }
    });

    collector.on("end", async (collected, reason) => {
      if (reason === "time") {
        await loadingMsg.edit({ 
          content: "⏰ Time expired. Bulk record cancelled.", 
          components: [], 
          embeds: [] 
        });
      }
    });
  },
};