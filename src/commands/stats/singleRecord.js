// singleRecord.js
// Usage (prefix): :?single-record <MENTION/USER_ID/USERNAME> <GOALS> <ASSISTS> <LEAGUE>
// Examples:
//   :?single-record @SomeUser 2 1 premier
//   :?single-record 123456789012345678 1 0 ucl
//   :?single-record SomeUser#1234 3 2 premier

import { models } from "../../models/leagues.model.js";

export default {
  name: "single-record",
  description:
    "Record a single player's goals/assists into the DB (prefix): ?single-record <user> <goals> <assists> <league>",

  async run({ message, interaction }) {
    const ctx = interaction ?? message;

    // Restrict to the same allowed user as recordstats
    const allowedUser = "759869571632332851";
    const authorId = interaction ? interaction.user.id : message.author.id;
    if (authorId !== allowedUser) {
      const replyOpt = interaction
        ? { content: "❌ Not allowed.", ephemeral: true }
        : { content: "❌ Not allowed." };
      return interaction
        ? interaction.reply(replyOpt)
        : message.reply(replyOpt);
    }

    // Parse input args (support message-based primarily; minimal support for slash)
    let userArg, goalsArg, assistsArg, leagueArg;
    if (interaction) {
      // If you later add a slash registration, this will pick the options (best-effort)
      userArg = interaction.options?.getString?.("user") ?? null;
      goalsArg = interaction.options?.getInteger?.("goals") ?? null;
      assistsArg = interaction.options?.getInteger?.("assists") ?? null;
      leagueArg = interaction.options?.getString?.("league") ?? null;

      // If any required option missing, ask for correct usage (slash should supply them)
      if (!userArg || goalsArg === null || assistsArg === null || !leagueArg) {
        return interaction.reply({
          content:
            "❌ Usage: `/single-record <user> <goals> <assists> <league>` (all required).",
          ephemeral: true,
        });
      }
    } else {
      // message-based parsing
      const parts = message.content.trim().split(/\s+/);
      // parts[0] is the command
      if (parts.length < 5) {
        return message.reply(
          "❌ Usage: `:?single-record <MENTION/USER_ID/USERNAME> <GOALS> <ASSISTS> <LEAGUE>`"
        );
      }
      userArg = parts[1];
      goalsArg = parts[2];
      assistsArg = parts[3];
      leagueArg = parts[4];
    }

    // Validate numeric goals/assists
    const goals = Number(goalsArg);
    const assists = Number(assistsArg);
    if (
      !Number.isFinite(goals) ||
      !Number.isFinite(assists) ||
      Number.isNaN(goals) ||
      Number.isNaN(assists) ||
      !Number.isInteger(goals) ||
      !Number.isInteger(assists) ||
      goals < 0 ||
      assists < 0
    ) {
      return ctx.reply(
        "❌ Invalid numbers. Goals and assists must be non-negative integers."
      );
    }

    // Validate league exists in models (case-insensitive match)
    const leagueKey = Object.keys(models).find(
      (k) => k.toLowerCase() === String(leagueArg).toLowerCase()
    );
    if (!leagueKey) {
      return ctx.reply(
        `❌ Unknown league "${leagueArg}". Valid leagues: ${Object.keys(
          models
        ).join(", ")}`
      );
    }

    // Resolve target user into a userId
    let targetUserId = null;
    const guild = message ? message.guild : interaction.guild;
    if (!guild) {
      return ctx.reply(
        "❌ Could not resolve guild. Use this command inside the server."
      );
    }

    // 1) mention format <@!id> or <@id>
    const mentionMatch = userArg.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
      targetUserId = mentionMatch[1];
    } else if (/^\d{17,19}$/.test(userArg)) {
      // 2) plain numeric ID
      targetUserId = userArg;
    } else {
      // 3) username or username#discrim or displayName - try to find member
      // first try exact tag username#1234
      const tagMatch = userArg.match(/^(.+)#(\d{4})$/);
      let member = null;
      try {
        if (tagMatch) {
          const [_, namePart, discrim] = tagMatch;
          member =
            guild.members.cache.find(
              (m) =>
                m.user.username === namePart && m.user.discriminator === discrim
            ) || null;
        }
        // second try exact username (case-insensitive)
        if (!member) {
          member =
            guild.members.cache.find(
              (m) => m.user.username.toLowerCase() === userArg.toLowerCase()
            ) || null;
        }
        // third try displayName (nickname)
        if (!member) {
          member =
            guild.members.cache.find(
              (m) =>
                (m.displayName || "").toLowerCase() === userArg.toLowerCase()
            ) || null;
        }
        // fourth try partial match on username or displayName
        if (!member) {
          member =
            guild.members.cache.find(
              (m) =>
                (m.user.username || "")
                  .toLowerCase()
                  .includes(userArg.toLowerCase()) ||
                (m.displayName || "")
                  .toLowerCase()
                  .includes(userArg.toLowerCase())
            ) || null;
        }

        if (member) targetUserId = member.user.id;
      } catch (err) {
        console.warn("Error while resolving member by username:", err);
      }
    }

    // If still no targetUserId, attempt a fetch by userArg if it's an ID-like string
    if (!targetUserId && /^\d{17,19}$/.test(userArg)) {
      try {
        const fetched = await guild.members.fetch(userArg).catch(() => null);
        if (fetched) targetUserId = fetched.user.id;
      } catch (err) {
        // ignore
      }
    }

    if (!targetUserId) {
      return ctx.reply(
        `❌ Could not find user "${userArg}". Use a mention, user ID, or exact username#1234.`
      );
    }

    // Write to DB
    try {
      const Model = models[leagueKey];
      if (!Model) {
        console.error("Model missing for league:", leagueKey);
        return ctx.reply("❌ Internal error: league model not found.");
      }

      let player = await Model.findOne({ userId: targetUserId });
      if (!player) {
        player = new Model({
          userId: targetUserId,
          goals: Number(goals) || 0,
          assists: Number(assists) || 0,
          cleansheets: 0,
          teamId: null,
        });
      } else {
        player.goals = (player.goals || 0) + Number(goals);
        player.assists = (player.assists || 0) + Number(assists);
        // do not modify cleansheets/teamId here
      }

      await player.save();

      // try to react to the invoking message with ✅ (silently ignore errors)
      try {
        if (!interaction && message && message.react) {
          await message.react("✅").catch(() => {});
        } else if (interaction && interaction.reply) {
          // if interaction-based, try reacting to the original interaction.message if available
          try {
            const orig = await interaction.fetchReply().catch(() => null);
            if (orig && orig.react) await orig.react("✅").catch(() => {});
          } catch (e) {}
        }
      } catch (err) {
        // ignore reaction errors
      }

      // Reply with confirmation and new totals
      // fetch member info for proper name display
      let displayName = `Unknown (${targetUserId})`;
      try {
        const member = await guild.members
          .fetch(targetUserId)
          .catch(() => null);
        if (member) {
          const nickname = member.displayName || member.user.username;
          const username = member.user.username;
          displayName = `${nickname} (${username})`;
        } else {
          // fallback if not in guild cache
          const user = await guild.client.users
            .fetch(targetUserId)
            .catch(() => null);
          if (user) displayName = user.username;
        }
      } catch (err) {
        console.warn("Could not fetch member for displayName:", err);
      }

      const resp =
        `✅ Recorded for **${displayName}** in **${leagueKey.toUpperCase()}**:\n` +
        `⚽ +${goals} goals | 👟 +${assists} assists\n\n` +
        `New totals — ⚽ ${player.goals} | 👟 ${player.assists}`;

      return ctx.reply(resp);
    } catch (err) {
      console.error("❌ Error in single-record:", err);
      return ctx.reply("❌ Failed to record stats. Check console for details.");
    }
  },
};
