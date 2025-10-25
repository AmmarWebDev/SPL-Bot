import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import teamsSchema from "../../models/teams.model.js";

const MAX_PLAYERS = 35;
const TEAMS_PER_PAGE = 10;

export default {
  data: new SlashCommandBuilder()
    .setName("rosters")
    .setDescription("Display all teams with their members count"),

  name: "rosters",

  async run({ interaction, message }) {
    const guild = interaction?.guild || message?.guild;
    const replyTarget = message || interaction;

    if (!guild)
      return replyTarget.reply("❌ Could not fetch guild.");

    try {
      const teams = await teamsSchema.find({}).lean();
      if (!teams.length)
        return replyTarget.reply("❌ No teams found in the database.");

      await guild.members.fetch();

      // Build the list of teams
      const teamLines = [];
      for (const team of teams) {
        const role =
          guild.roles.cache.get(team.roleId) ||
          (await guild.roles.fetch(team.roleId).catch(() => null));
        if (!role) continue;

        const memberCount = role.members.size;
        const emoji = team.emoji || "⚽";
        teamLines.push(`${emoji} ${memberCount}/${MAX_PLAYERS} - <@&${role.id}>`);
      }

      if (!teamLines.length)
        return replyTarget.reply("❌ No valid teams found in the guild.");

      // Paginate
      const totalPages = Math.ceil(teamLines.length / TEAMS_PER_PAGE);
      let currentPage = 0;

      const generateEmbed = (page) => {
        const start = page * TEAMS_PER_PAGE;
        const end = start + TEAMS_PER_PAGE;
        const pageTeams = teamLines.slice(start, end);

        return new EmbedBuilder()
          .setTitle("📊 Team Rosters")
          .setColor(0x3498db)
          .setDescription(pageTeams.join("\n"))
          .setFooter({ text: `Page ${page + 1} of ${totalPages} • SPL League` })
          .setTimestamp();
      };

      // Buttons for pagination
      const getButtons = (page) => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("prev")
            .setLabel("◀️ Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("next")
            .setLabel("Next ▶️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1)
        );
      };

      const embed = generateEmbed(currentPage);
      const components = totalPages > 1 ? [getButtons(currentPage)] : [];

      const reply =
        interaction
          ? await interaction.reply({ embeds: [embed], components })
          : await message.reply({ embeds: [embed], components });

      if (totalPages === 1) return;

      // Button collector for pagination
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000, // 1 minute
      });

      collector.on("collect", async (btnInt) => {
        if (btnInt.user.id !== (interaction?.user.id || message.author.id))
          return btnInt.reply({
            content: "❌ Only the command user can navigate these pages.",
            ephemeral: true,
          });

        if (btnInt.customId === "prev" && currentPage > 0) currentPage--;
        else if (btnInt.customId === "next" && currentPage < totalPages - 1)
          currentPage++;

        await btnInt.update({
          embeds: [generateEmbed(currentPage)],
          components: [getButtons(currentPage)],
        });
      });

      collector.on("end", async () => {
        if (reply.editable) {
          await reply.edit({
            components: [],
          }).catch(() => null);
        }
      });
    } catch (err) {
      console.error("❌ Failed to fetch rosters:", err);
      return replyTarget.reply("❌ Failed to fetch team rosters.");
    }
  },
};
