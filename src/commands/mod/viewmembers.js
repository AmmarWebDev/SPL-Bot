import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("viewmembers")
    .setDescription("Show all members with one or more roles")
    .addStringOption((opt) =>
      opt
        .setName("roles")
        .setDescription("Select one or more roles (space-separated role IDs)")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  name: "viewmembers",

  async autocomplete({ interaction }) {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "roles") return;
      const roles = interaction.guild.roles.cache
        .filter((r) => r.name !== "@everyone")
        .map((role) => ({ name: role.name, value: role.id }));
      await interaction.respond(roles.slice(0, 25));
    } catch (err) {
      console.error("❌ Autocomplete error (viewmembers):", err);
    }
  },

  async run({ message, interaction }) {
    const ctx = interaction ?? message;
    try {
      // permission check
      const member = interaction ? interaction.member : message.member;
      if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const replyOpt = interaction
          ? {
              content: "❌ You need **Manage Roles**.",
              flags: MessageFlags.Ephemeral,
            }
          : { content: "❌ You need **Manage Roles**." };
        return interaction
          ? interaction.reply(replyOpt)
          : message.reply(replyOpt);
      }

      // get roles input
      let roleIdsInput;
      if (message) {
        const args = message.content.split(" ").slice(1);
        if (args.length === 0)
          return message.reply(
            "❌ Usage: `?viewmembers <role mention | role ID> [more roles...] [--all]`"
          );
        roleIdsInput = args.filter((a) => a !== "--all");
      } else {
        roleIdsInput = interaction.options.getString("roles").split(/\s+/);
      }

      const showAll = message ? message.content.includes("--all") : false;

      const roleIds = roleIdsInput.map((arg) => {
        const match = arg.match(/^<@&(\d+)>$/);
        return match ? match[1] : arg;
      });

      const roles = roleIds
        .map((id) => ctx.guild.roles.cache.get(id))
        .filter((r) => !!r);
      if (roles.length === 0)
        return interaction
          ? interaction.reply({
              content: "❌ No valid roles found.",
              flags: MessageFlags.Ephemeral,
            })
          : message.reply("❌ No valid roles found.");

      await ctx.guild.members.fetch();
      const members = ctx.guild.members.cache.filter((m) =>
        roles.every((r) => m.roles.cache.has(r.id))
      );

      if (members.size === 0)
        return interaction
          ? interaction.reply({
              content: "⚠️ No members found.",
              flags: MessageFlags.Ephemeral,
            })
          : message.reply("⚠️ No members found with those roles.");

      if (showAll) {
        // show all in chunks
        const mentions = members.map((m) => `<@${m.user.id}>`);
        const chunks = [];
        let chunk = "";
        for (const mention of mentions) {
          if ((chunk + mention + "\n").length > 4000) {
            chunks.push(chunk);
            chunk = "";
          }
          chunk += mention + "\n";
        }
        if (chunk) chunks.push(chunk);

        for (const [i, chunkText] of chunks.entries()) {
          const embed = new EmbedBuilder()
            .setTitle(`👥 Members with role(s) ${i + 1}/${chunks.length}`)
            .setDescription(
              `**Roles:** ${roles
                .map((r) => r.toString())
                .join(", ")}\n\n${chunkText}`
            )
            .setColor("Blue");
          await (message
            ? message.channel.send({
                embeds: [embed],
                allowedMentions: { parse: [] },
              })
            : interaction.followUp({
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
              }));
        }
        return;
      }

      const pages = createPages(members, roles);
      await sendPaginated(ctx, pages, !!interaction);
    } catch (err) {
      console.error("❌ Error in viewmembers command:", err);
      if (interaction) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "⚠️ Something went wrong.",
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: "⚠️ Something went wrong.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } else {
        await message.reply("⚠️ Something went wrong. Check console logs.");
      }
    }
  },
};

// -------- helpers (pagination) ----------
function createPages(members, roles) {
  const pages = [];
  const membersArray = Array.from(members.values());

  for (let i = 0; i < membersArray.length; i += 10) {
    const chunk = membersArray.slice(i, i + 10);
    const mentions = chunk.map((m) => `<@${m.user.id}>`).join("\n");

    const embed = new EmbedBuilder()
      .setTitle("👥 Members with role(s)")
      .setDescription(
        `**Roles:** ${roles.map((r) => r.toString()).join(", ")}\n\n${mentions}`
      )
      .setColor("Blue")
      .setFooter({
        text: `Page ${Math.floor(i / 10) + 1}/${Math.ceil(
          membersArray.length / 10
        )}`,
      });

    pages.push(embed);
  }

  return pages;
}

async function sendPaginated(ctx, pages, isInteraction = false) {
  let page = 0;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("⬅️ Prev")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("➡️ Next")
      .setStyle(ButtonStyle.Secondary)
  );

  let msg;
  if (isInteraction) {
    await ctx.reply({
      embeds: [pages[page]],
      components: pages.length > 1 ? [row] : [],
      flags: MessageFlags.Ephemeral,
    });
    msg = await ctx.fetchReply();
  } else {
    msg = await ctx.channel.send({
      embeds: [pages[page]],
      components: pages.length > 1 ? [row] : [],
      allowedMentions: { parse: [] },
    });
  }

  if (pages.length <= 1) return;

  const filter = (i) =>
    ["prev", "next"].includes(i.customId) &&
    i.user.id === (ctx.user?.id || ctx.author.id);

  const collector = msg.createMessageComponentCollector({
    filter,
    time: 60000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "prev") page = page > 0 ? --page : pages.length - 1;
    if (i.customId === "next") page = page + 1 < pages.length ? ++page : 0;
    await i.update({ embeds: [pages[page]], components: [row] });
  });

  collector.on("end", async () => {
    try {
      if (msg.editable) await msg.edit({ components: [] });
    } catch {}
  });
}
