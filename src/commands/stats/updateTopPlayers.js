// src/commands/stats/updateTopPlayers.js
import { PermissionsBitField, EmbedBuilder } from "discord.js";
import mongoose from "mongoose";
import Channels from "../../models/channels.model.js";

/** Helpers */

// Hardcoded season label (always Season 6)
const SEASON_LABEL = "Season 6";

// strip trailing "-result" and trim
function normalizeLeagueSlug(slug) {
  if (!slug) return null;
  return String(slug).replace(/-result$/i, "").trim();
}

// normalize to lower alphanum
function normalizeSlug(slug) {
  return String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// slug -> PascalCase candidate
function slugToPascal(slug) {
  return String(slug || "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}

// Pretty display name
function prettyLeagueName(slug) {
  if (!slug) return "";
  return String(slug)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");
}

// Escape regex special characters
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHeaderRegex(pretty, type) {
  const safe = escapeRegex(pretty).replace(/[\s-]+/g, "\\s*");
  return new RegExp(`top\\s*10\\s+${safe}.*${escapeRegex(type)}`, "i");
}

function formatTopList(items, label, prettyLeague) {
  const containsSeason =
    String(prettyLeague || "").toLowerCase().includes(SEASON_LABEL.toLowerCase());

  const headerBase = containsSeason
    ? `# Top 10 ${prettyLeague} ${label === "Goals" ? "Scorers" : "Assisters"}!\n\n`
    : `# Top 10 ${SEASON_LABEL} ${prettyLeague} ${
        label === "Goals" ? "Scorers" : "Assisters"
      }!\n\n`;

  const lines = items.map((p, i) => {
    const mention = `<@${p.userId}>`;
    const count = p.count ?? 0;
    if (i === 0) return `🥇 ${mention} — ${count} ${label}`;
    if (i === 1) return `🥈 ${mention} — ${count} ${label.toLowerCase()}`;
    if (i === 2) return `🥉 ${mention} — ${count} ${label.toLowerCase()}`;
    return `${mention} --- ${count} ${label.toLowerCase()}`;
  });

  return headerBase + (lines.length ? lines.join("\n") : `No ${label.toLowerCase()} yet.`);
}

export default {
  name: "update-top-players",

  async run(options = {}) {
    const { message } = options;

    if (!message || !message.member) {
      return message?.reply?.("❌ This command must be run in a server channel.");
    }

    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need the **Administrator** permission to use this command.");
    }

    const configs = await Channels.find({ type: "top-players" }).lean();
    if (!configs.length) {
      return message.reply("⚠️ No `top-players` configurations found.");
    }

    let statusMsg = await message.reply("🔄 Updating top players...");

    const statsUri = process.env.MONGODB_STATS_URI;
    if (!statsUri) {
      return statusMsg.edit("❌ Stats DB URI missing.");
    }

    const statsConn = mongoose.createConnection(statsUri);
    await statsConn.asPromise();

    const cols = await statsConn.db.listCollections().toArray();
    const statsCollections = cols.map((c) => c.name);

    const memberCache = new Map();
    async function memberExists(id) {
      if (memberCache.has(id)) return memberCache.get(id);
      try {
        await message.guild.members.fetch(id);
        memberCache.set(id, true);
        return true;
      } catch {
        memberCache.set(id, false);
        return false;
      }
    }

    const results = { updated: [], created: [] };

    async function processSingleConfig(cfg) {
      const slug = normalizeLeagueSlug(cfg.league);
      if (!slug) return;

      const collectionName =
        cfg.collectionName ||
        statsCollections.find((c) =>
          c.toLowerCase().includes(normalizeSlug(slug))
        );

      if (!collectionName) return;

      const coll = statsConn.db.collection(collectionName);

      const scorers = await coll
        .find({ goals: { $gt: 0 } })
        .sort({ goals: -1 })
        .limit(20)
        .toArray();

      const assisters = await coll
        .find({ assists: { $gt: 0 } })
        .sort({ assists: -1 })
        .limit(20)
        .toArray();

      const topScorers = [];
      for (const s of scorers) {
        if (await memberExists(s.userId)) topScorers.push({ userId: s.userId, count: s.goals });
        if (topScorers.length === 10) break;
      }

      const topAssisters = [];
      for (const a of assisters) {
        if (await memberExists(a.userId))
          topAssisters.push({ userId: a.userId, count: a.assists });
        if (topAssisters.length === 10) break;
      }

      const pretty = prettyLeagueName(slug);

      const scorersText = formatTopList(topScorers, "Goals", pretty);
      const assistersText = formatTopList(topAssisters, "Assists", pretty);

      const url = cfg.topPlayersChannelUrl || cfg.url;
      if (!url) return;

      const [, channelId] = url.match(/channels\/\d+\/(\d+)/) || [];
      if (!channelId) return;

      const channel = await message.client.channels.fetch(channelId);
      const recent = await channel.messages.fetch({ limit: 50 });

      let scorerMsg, assisterMsg;
      const scorerRegex = buildHeaderRegex(`${SEASON_LABEL} ${pretty}`, "Scorers");
      const assisterRegex = buildHeaderRegex(`${SEASON_LABEL} ${pretty}`, "Assisters");

      for (const m of recent.values()) {
        if (m.author.id !== message.client.user.id) continue;
        if (!scorerMsg && scorerRegex.test(m.content)) scorerMsg = m;
        if (!assisterMsg && assisterRegex.test(m.content)) assisterMsg = m;
      }

      if (scorerMsg) {
        await scorerMsg.edit(scorersText);
        results.updated.push(`${pretty} Scorers`);
      } else {
        await channel.send(scorersText);
        results.created.push(`${pretty} Scorers`);
      }

      if (assisterMsg) {
        await assisterMsg.edit(assistersText);
        results.updated.push(`${pretty} Assisters`);
      } else {
        await channel.send(assistersText);
        results.created.push(`${pretty} Assisters`);
      }
    }

    for (const cfg of configs) {
      if (String(cfg.league).toLowerCase() !== "all") {
        await processSingleConfig(cfg);
      }
    }

    await statsConn.close();

    // ===== FINAL EMBED RESPONSE =====
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("🏆 Top Players Updated")
      .setDescription(
        [
          results.updated.length && `🔄 **Updated:** ${results.updated.length}`,
          results.created.length && `✨ **Created:** ${results.created.length}`,
        ]
          .filter(Boolean)
          .join("\n") || "No changes detected."
      )
      .setFooter({ text: SEASON_LABEL });

    await statusMsg.edit({ content: null, embeds: [embed] });
  },
};
