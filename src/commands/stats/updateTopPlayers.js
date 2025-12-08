// src/commands/stats/updateTopPlayers.js
import { PermissionsBitField } from "discord.js";
import mongoose from "mongoose";
import Channels from "../../models/channels.model.js";

/** Helpers */
// remove trailing "-result" suffix and trim
function normalizeLeagueSlug(slug) {
  if (!slug) return null;
  return String(slug).replace(/-result$/i, "").trim();
}

// basic slug -> normalized lower string
function normalizeSlug(slug) {
  return String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// slug -> PascalCase candidate: la-liga -> LaLiga
function slugToPascal(slug) {
  return String(slug || "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

// pretty name for display: la-liga -> "La Liga"
function prettyLeagueName(slug) {
  if (!slug) return "";
  return String(slug)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

// tolerant regex for matching header in messages/embeds
function buildHeaderRegex(pretty, type) {
  const safe = pretty.replace(/[-\s]+/g, "\\s*");
  return new RegExp(`top\\s*10\\s*${safe}.*${type}`, "i");
}

// format exactly as requested
function formatTopList(items, label, prettyLeague) {
  const header = `# Top 10 ${prettyLeague} ${label === "Goals" ? "Scorers" : "Assisters"}!\n\n`;
  const lines = items.map((p, i) => {
    const mention = `<@${p.userId}>`;
    const count = p.count ?? 0;
    if (i === 0) return `🥇 ${mention} — ${count} ${label}`;
    if (i === 1) return `🥈 ${mention} — ${count} ${label.toLowerCase()}`;
    if (i === 2) return `🥉 ${mention} — ${count} ${label.toLowerCase()}`;
    return `${mention} --- ${count} ${label.toLowerCase()}`;
  });
  return header + (lines.length ? lines.join("\n") : `No ${label.toLowerCase()} yet.`);
}

export default {
  name: "update-top-players",

  /**
   * Admin-only. Updates ALL leagues stored with type: "top-players".
   * Supports config fields:
   *  - league (slug, e.g. "la-liga" or "la-liga-result")
   *  - collectionName (optional explicit Mongo collection name e.g. "LaLiga")
   *  - topPlayersChannelUrl | topPlayersUrl | url
   */
  async run(options = {}) {
    const { message } = options;

    // guards
    if (!message || !message.member) return message?.reply?.("❌ This command must be run in a server channel.");
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need the **Administrator** permission to use this command.");
    }

    // load configs
    const configs = await Channels.find({ type: "top-players" }).lean();
    if (!configs || configs.length === 0) {
      return message.reply("⚠️ No `top-players` configurations found in the database.");
    }

    const statsUri = process.env.MONGODB_STATS_URI;
    if (!statsUri) {
      console.error("MONGODB_STATS_URI missing in .env");
      return message.reply("❌ Server misconfiguration: stats DB URI not found.");
    }

    // connect to stats DB
    const statsConn = mongoose.createConnection(statsUri, {});
    try {
      await statsConn.asPromise();
    } catch (err) {
      console.error("Failed to connect to stats DB:", err);
      return message.reply("❌ Failed to connect to stats DB. See console.");
    }

    // get collections list to improve matching (optional)
    let statsCollections = [];
    try {
      const cols = await statsConn.db.listCollections().toArray();
      statsCollections = cols.map((c) => String(c.name));
    } catch (e) {
      statsCollections = [];
    }

    // cache guild member existence
    const memberCache = new Map();
    async function memberExists(userId) {
      if (!userId) return false;
      if (memberCache.has(userId)) return memberCache.get(userId);
      if (message.guild.members.cache.has(userId)) {
        memberCache.set(userId, true);
        return true;
      }
      try {
        await message.guild.members.fetch(userId);
        memberCache.set(userId, true);
        return true;
      } catch {
        memberCache.set(userId, false);
        return false;
      }
    }

    const results = { updated: [], created: [], skipped: [], errors: [] };

    for (const cfg of configs) {
      try {
        // normalize league slug (strip "-result" suffix)
        const rawLeague = cfg.league;
        const leagueSlug = normalizeLeagueSlug(rawLeague);
        if (!leagueSlug) {
          results.skipped.push({ cfg, reason: "missing league field" });
          continue;
        }

        // pick collectionName candidates
        const explicitColl = cfg.collectionName && String(cfg.collectionName).trim();
        const candidates = [];
        if (explicitColl) candidates.push(explicitColl);

        const pascal = slugToPascal(leagueSlug); // LaLiga or DFBPokal
        const normalized = normalizeSlug(leagueSlug); // laliga
        const fallbackJoin = leagueSlug
          .split(/[^a-z0-9]+/i)
          .filter(Boolean)
          .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
          .join("");

        [pascal, fallbackJoin, normalized].forEach((c) => {
          if (c && !candidates.includes(c)) candidates.push(c);
        });

        // try to resolve to a real collection name (if collections list available)
        let collectionName = null;
        if (statsCollections.length) {
          const exact = statsCollections.find((n) =>
            candidates.some((cand) => String(n).toLowerCase() === String(cand).toLowerCase())
          );
          if (exact) collectionName = exact;
          else {
            const incl = statsCollections.find((n) => String(n).toLowerCase().includes(normalized));
            if (incl) collectionName = incl;
            else {
              const incl2 = statsCollections.find((n) => String(n).toLowerCase().includes(pascal.toLowerCase()));
              if (incl2) collectionName = incl2;
            }
          }
        }

        if (!collectionName) collectionName = candidates[0];
        if (!collectionName) {
          results.skipped.push({ league: leagueSlug, reason: "no candidate collection name", tried: candidates });
          continue;
        }

        const coll = statsConn.db.collection(collectionName);

        // fetch generous rows so we can filter out non-members (avoid missing legitimate top players)
        const FETCH_LIMIT = 500;

        // Raw fetch: scorers and assisters (positive stats only)
        const rawScorersRaw = await coll
          .find({ goals: { $gt: 0 } })
          .sort({ goals: -1, assists: -1, userId: 1 })
          .limit(FETCH_LIMIT)
          .toArray()
          .catch(() => []);

        const rawAssistersRaw = await coll
          .find({ assists: { $gt: 0 } })
          .sort({ assists: -1, goals: -1, userId: 1 })
          .limit(FETCH_LIMIT)
          .toArray()
          .catch(() => []);

        // HARD FILTER deleted / non-existing guild members BEFORE building final top list
        const rawScorers = [];
        for (const row of rawScorersRaw) {
          if (!row || !row.userId) continue;
          if (await memberExists(row.userId)) rawScorers.push(row);
          if (rawScorers.length >= FETCH_LIMIT) break;
        }

        const rawAssisters = [];
        for (const row of rawAssistersRaw) {
          if (!row || !row.userId) continue;
          if (await memberExists(row.userId)) rawAssisters.push(row);
          if (rawAssisters.length >= FETCH_LIMIT) break;
        }

        // Now take top 10 from the filtered lists
        const filteredScorers = rawScorers
          .map((d) => ({ userId: d.userId, count: Number(d.goals) || 0 }))
          .slice(0, 10);

        const filteredAssisters = rawAssisters
          .map((d) => ({ userId: d.userId, count: Number(d.assists) || 0 }))
          .slice(0, 10);

        const pretty = prettyLeagueName(leagueSlug);
        const scorersText = formatTopList(filteredScorers, "Goals", pretty);
        const assistersText = formatTopList(filteredAssisters, "Assists", pretty);

        // determine top players channel
        const finalTopPlayersUrl = cfg.topPlayersChannelUrl || cfg.topPlayersUrl || cfg.url;
        if (!finalTopPlayersUrl) {
          results.skipped.push({ league: leagueSlug, reason: "no topPlayersChannelUrl/url on config" });
          continue;
        }

        const match = finalTopPlayersUrl.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/);
        if (!match) {
          results.skipped.push({ league: leagueSlug, reason: "invalid channel url in config", url: finalTopPlayersUrl });
          continue;
        }
        const topChannelId = match[1];

        const channel = await message.client.channels.fetch(topChannelId).catch(() => null);
        if (!channel) {
          results.skipped.push({ league: leagueSlug, reason: "failed to fetch channel", channelId: topChannelId });
          continue;
        }

        // find existing bot messages by header (content or embed)
        const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        let scorerMsg = null;
        let assisterMsg = null;
        const scorerRegex = buildHeaderRegex(pretty, "Scorers");
        const assisterRegex = buildHeaderRegex(pretty, "Assisters");

        if (recent) {
          for (const m of recent.values()) {
            if (m.author?.id !== message.client.user?.id) continue;
            const content = String(m.content || "");
            if (!scorerMsg && scorerRegex.test(content)) scorerMsg = m;
            if (!assisterMsg && assisterRegex.test(content)) assisterMsg = m;

            if ((!scorerMsg || !assisterMsg) && m.embeds && m.embeds.length) {
              for (const e of m.embeds) {
                if (!scorerMsg && e.title && scorerRegex.test(String(e.title))) scorerMsg = m;
                if (!assisterMsg && e.title && assisterRegex.test(String(e.title))) assisterMsg = m;
                if (!scorerMsg && e.description && scorerRegex.test(String(e.description))) scorerMsg = m;
                if (!assisterMsg && e.description && assisterRegex.test(String(e.description))) assisterMsg = m;
                if (scorerMsg && assisterMsg) break;
              }
            }
            if (scorerMsg && assisterMsg) break;
          }
        }

        // edit/create
        if (scorerMsg) {
          await scorerMsg.edit(scorersText);
          results.updated.push({ league: leagueSlug, section: "scorers", channel: topChannelId, count: filteredScorers.length });
        } else {
          await channel.send(scorersText);
          results.created.push({ league: leagueSlug, section: "scorers", channel: topChannelId, count: filteredScorers.length });
        }

        if (assisterMsg) {
          await assisterMsg.edit(assistersText);
          results.updated.push({ league: leagueSlug, section: "assisters", channel: topChannelId, count: filteredAssisters.length });
        } else {
          await channel.send(assistersText);
          results.created.push({ league: leagueSlug, section: "assisters", channel: topChannelId, count: filteredAssisters.length });
        }
      } catch (errInner) {
        console.error("Error updating league config:", cfg, errInner);
        results.errors.push({ cfg, error: String(errInner) });
      }
    } // end for

    // close stats connection
    try {
      await statsConn.close();
    } catch (e) {
      // ignore
    }

    const summary = [
      `✅ Top players update finished.`,
      `• Sections edited: ${results.updated.length}`,
      `• Sections created: ${results.created.length}`,
      `• Skipped configs: ${results.skipped.length}`,
      `• Errors: ${results.errors.length}`,
      "",
      `(If some leagues show no entries, check the "collectionName" field in the DB config or that players exist in the guild.)`,
    ].join("\n");

    return message.reply(summary);
  },
};
