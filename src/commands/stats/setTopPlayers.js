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

// slug -> PascalCase candidate e.g. "la-liga" -> "LaLiga"
function slugToPascal(slug) {
  return String(slug || "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

// Pretty display name "la-liga" -> "La Liga"
function prettyLeagueName(slug) {
  if (!slug) return "";
  return String(slug)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

// Escape regex special characters
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a strict header regex from the passed pretty string:
 * - Caller must include Season in the pretty if they require it.
 * - Example: buildHeaderRegex("Season 6 La Liga", "Scorers")
 *   will match "Top 10 Season 6 La Liga Scorers" (case-insensitive)
 */
function buildHeaderRegex(pretty, type) {
  const safe = escapeRegex(pretty).replace(/[\s-]+/g, "\\s*");
  // require "Top 10" then some whitespace then the exact pretty (with flexible spaces/hyphens), then the type
  return new RegExp(`top\\s*10\\s+${safe}.*${escapeRegex(type)}`, "i");
}

/**
 * Format top list text according to your requested layout.
 * items: array of { userId, count } where count is goals or assists
 * prettyLeague: either "La Liga" (normal leagues) or "All Season 6 Leagues" (aggregate)
 *
 * Header generation:
 * - If prettyLeague already contains the season label (case-insensitive), we use it as-is:
 *   "# Top 10 All Season 6 Leagues Scorers!"
 * - Otherwise we prefix with the season label:
 *   "# Top 10 Season 6 La Liga Scorers!"
 */
function formatTopList(items, label, prettyLeague) {
  const containsSeason =
    String(prettyLeague || "").toLowerCase().includes(SEASON_LABEL.toLowerCase());
  const headerBase = containsSeason
    ? `# Top 10 ${prettyLeague} ${label === "Goals" ? "Scorers" : "Assisters"}!\n\n`
    : `# Top 10 ${SEASON_LABEL} ${prettyLeague} ${label === "Goals" ? "Scorers" : "Assisters"}!\n\n`;

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

  /**
   * Admin-only. Updates ALL leagues stored with type: "top-players".
   * Supports config fields:
   *  - league: slug or "all"
   *  - collectionName: optional explicit Mongo collection (recommended)
   *  - topPlayersChannelUrl | topPlayersUrl | url
   */
  async run(options = {}) {
    const { message } = options;

    // Guards
    if (!message || !message.member) return message?.reply?.("❌ This command must be run in a server channel.");
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need the **Administrator** permission to use this command.");
    }

    // Load configs
    const configs = await Channels.find({ type: "top-players" }).lean();
    if (!configs || configs.length === 0) {
      return message.reply("⚠️ No `top-players` configurations found in the database.");
    }

    // Send status message and keep it to edit later
    let statusMsg;
    try {
      statusMsg = await message.reply("🔄 Updating top players...");
    } catch (e) {
      statusMsg = null;
    }

    const statsUri = process.env.MONGODB_STATS_URI;
    if (!statsUri) {
      console.error("MONGODB_STATS_URI missing in .env");
      if (statusMsg) await statusMsg.edit("❌ Server misconfiguration: stats DB URI not found.");
      return;
    }

    // Connect to stats DB
    const statsConn = mongoose.createConnection(statsUri, {});
    try {
      await statsConn.asPromise();
    } catch (err) {
      console.error("Failed to connect to stats DB:", err);
      if (statusMsg) await statusMsg.edit("❌ Failed to connect to stats DB. See console.");
      return;
    }

    // Get list of collections in stats DB (optional; helps matching)
    let statsCollections = [];
    try {
      const cols = await statsConn.db.listCollections().toArray();
      statsCollections = cols.map((c) => String(c.name));
    } catch (e) {
      statsCollections = [];
    }

    // Helper: resolve collection candidates for a given league slug/config
    function resolveCollectionCandidates(leagueSlug, explicitColl) {
      const candidates = [];
      if (explicitColl) candidates.push(explicitColl.trim());
      const pascal = slugToPascal(leagueSlug);
      const normalized = normalizeSlug(leagueSlug);
      const fallbackJoin = leagueSlug
        .split(/[^a-z0-9]+/i)
        .filter(Boolean)
        .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
        .join("");
      [pascal, fallbackJoin, normalized].forEach((c) => {
        if (c && !candidates.includes(c)) candidates.push(c);
      });
      return candidates;
    }

    // Cache member existence
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

    const results = { updated: [], created: [] };

    // ---------- Pre-resolve collection names for non-"all" configs ----------
    const resolvedCollections = new Set();
    const perLeagueResolved = new Map(); // cfg._id -> collectionName (string)
    for (const cfg of configs) {
      try {
        if (!cfg || !cfg.league) continue;
        if (String(cfg.league).toLowerCase() === "all") continue; // skip aggregate config here

        const raw = cfg.league;
        const leagueSlug = normalizeLeagueSlug(raw);
        const explicitColl = cfg.collectionName && String(cfg.collectionName).trim();
        const candidates = resolveCollectionCandidates(leagueSlug, explicitColl);

        // try to find best match among actual collections
        let collectionName = null;
        if (statsCollections.length) {
          const exact = statsCollections.find((n) =>
            candidates.some((cand) => String(n).toLowerCase() === String(cand).toLowerCase())
          );
          if (exact) collectionName = exact;
          else {
            const incl = statsCollections.find((n) => String(n).toLowerCase().includes(normalizeSlug(leagueSlug)));
            if (incl) collectionName = incl;
            else {
              const incl2 = statsCollections.find((n) => String(n).toLowerCase().includes(slugToPascal(leagueSlug).toLowerCase()));
              if (incl2) collectionName = incl2;
            }
          }
        }

        if (!collectionName) collectionName = candidates[0];
        if (collectionName) {
          resolvedCollections.add(collectionName);
          perLeagueResolved.set(String(cfg._id), collectionName);
        }
      } catch (e) {
        // ignore resolution errors here
      }
    }

    // ---------- Helper to update single league config ----------
    async function processSingleConfig(cfg) {
      try {
        const rawLeague = cfg.league;
        const leagueSlug = normalizeLeagueSlug(rawLeague);
        if (!leagueSlug) return;

        const explicitColl = cfg.collectionName && String(cfg.collectionName).trim();
        const candidates = resolveCollectionCandidates(leagueSlug, explicitColl);

        let collectionName = perLeagueResolved.get(String(cfg._id)) || null;
        if (!collectionName) {
          if (statsCollections.length) {
            const exact = statsCollections.find((n) =>
              candidates.some((cand) => String(n).toLowerCase() === String(cand).toLowerCase())
            );
            if (exact) collectionName = exact;
            else {
              const incl = statsCollections.find((n) => String(n).toLowerCase().includes(normalizeSlug(leagueSlug)));
              if (incl) collectionName = incl;
              else {
                const incl2 = statsCollections.find((n) => String(n).toLowerCase().includes(slugToPascal(leagueSlug).toLowerCase()));
                if (incl2) collectionName = incl2;
              }
            }
          }
        }
        if (!collectionName) collectionName = candidates[0];
        if (!collectionName) return;

        const coll = statsConn.db.collection(collectionName);
        const FETCH_LIMIT = 500;

        // Raw fetch (positive stats only)
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

        // Hard-filter non-members before final top list
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

        const filteredScorers = rawScorers.map((d) => ({ userId: d.userId, count: Number(d.goals) || 0 })).slice(0, 10);
        const filteredAssisters = rawAssisters.map((d) => ({ userId: d.userId, count: Number(d.assists) || 0 })).slice(0, 10);

        const pretty = prettyLeagueName(leagueSlug); // e.g. "La Liga"
        // For single leagues, require Season in the header: "Season 6 La Liga"
        const headerPretty = `${SEASON_LABEL} ${pretty}`;

        const scorersText = formatTopList(filteredScorers, "Goals", pretty);
        const assistersText = formatTopList(filteredAssisters, "Assists", pretty);

        const finalTopPlayersUrl = cfg.topPlayersChannelUrl || cfg.topPlayersUrl || cfg.url;
        if (!finalTopPlayersUrl) return;

        const match = finalTopPlayersUrl.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/);
        if (!match) return;
        const topChannelId = match[1];

        const channel = await message.client.channels.fetch(topChannelId).catch(() => null);
        if (!channel) return;

        // find existing messages (content or embed) — now requires "Season 6" prefix in search
        const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        let scorerMsg = null;
        let assisterMsg = null;

        const scorerRegex = buildHeaderRegex(`${SEASON_LABEL} ${pretty}`, "Scorers");
        const assisterRegex = buildHeaderRegex(`${SEASON_LABEL} ${pretty}`, "Assisters");

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
      } catch (errInner) {
        console.error("Error updating league config:", cfg, errInner);
      }
    } // end processSingleConfig

    // ---------- Helper to process the "all" aggregate ----------
    async function processAllAggregate(cfgAll) {
      try {
        // Build the list of collection names to consider.
        const collectionNames = Array.from(resolvedCollections);
        // If none resolved (configs missing collectionName), fallback to statsCollections list
        if (!collectionNames.length && statsCollections.length) {
          collectionNames.push(...statsCollections.filter((n) => !n.startsWith("system.")));
        }
        if (!collectionNames.length) return;

        const FETCH_PER_COLL = 200; // per collection fetch limit

        // accumulators
        const goalsMap = new Map(); // userId -> total goals
        const assistsMap = new Map(); // userId -> total assists

        // iterate collections and sum up
        for (const collName of collectionNames) {
          try {
            const coll = statsConn.db.collection(collName);

            const rowsG = await coll
              .find({ goals: { $gt: 0 } })
              .sort({ goals: -1, assists: -1 })
              .limit(FETCH_PER_COLL)
              .toArray()
              .catch(() => []);

            for (const r of rowsG) {
              if (!r || !r.userId) continue;
              const g = Number(r.goals) || 0;
              if (g <= 0) continue;
              goalsMap.set(r.userId, (goalsMap.get(r.userId) || 0) + g);
            }

            const rowsA = await coll
              .find({ assists: { $gt: 0 } })
              .sort({ assists: -1, goals: -1 })
              .limit(FETCH_PER_COLL)
              .toArray()
              .catch(() => []);

            for (const r of rowsA) {
              if (!r || !r.userId) continue;
              const a = Number(r.assists) || 0;
              if (a <= 0) continue;
              assistsMap.set(r.userId, (assistsMap.get(r.userId) || 0) + a);
            }
          } catch (e) {
            continue;
          }
        } // end collections loop

        // convert to arrays, filter by guild membership, sort, take top 10
        const goalsArr = [];
        for (const [userId, total] of goalsMap) {
          if (total <= 0) continue;
          if (await memberExists(userId)) goalsArr.push({ userId, count: total });
        }
        goalsArr.sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
        const topScorers = goalsArr.slice(0, 10);

        const assistsArr = [];
        for (const [userId, total] of assistsMap) {
          if (total <= 0) continue;
          if (await memberExists(userId)) assistsArr.push({ userId, count: total });
        }
        assistsArr.sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
        const topAssisters = assistsArr.slice(0, 10);

        // For all leagues we want the header: "All Season 6 Leagues"
        const allPretty = `All ${SEASON_LABEL} Leagues`;
        const scorersText = formatTopList(topScorers, "Goals", allPretty);
        const assistersText = formatTopList(topAssisters, "Assists", allPretty);

        // find channel
        const finalTopPlayersUrl = cfgAll.topPlayersChannelUrl || cfgAll.topPlayersUrl || cfgAll.url;
        if (!finalTopPlayersUrl) return;
        const match = finalTopPlayersUrl.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/);
        if (!match) return;
        const topChannelId = match[1];

        const channel = await message.client.channels.fetch(topChannelId).catch(() => null);
        if (!channel) return;

        // Try to find existing messages for "All Season 6 Leagues" using header regex
        const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        let scorerMsg = null;
        let assisterMsg = null;
        const scorerRegex = buildHeaderRegex(allPretty, "Scorers");
        const assisterRegex = buildHeaderRegex(allPretty, "Assisters");

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

        if (scorerMsg) {
          await scorerMsg.edit(scorersText);
          results.updated.push(`${allPretty} Scorers`);
        } else {
          await channel.send(scorersText);
          results.created.push(`${allPretty} Scorers`);
        }

        if (assisterMsg) {
          await assisterMsg.edit(assistersText);
          results.updated.push(`${allPretty} Assisters`);
        } else {
          await channel.send(assistersText);
          results.created.push(`${allPretty} Assisters`);
        }
      } catch (e) {
        console.error("Error processing ALL aggregate:", e);
      }
    } // end processAllAggregate

    // ---------- Main processing ----------
    for (const cfg of configs) {
      if (String(cfg.league).toLowerCase() === "all") continue; // postpone "all"
      await processSingleConfig(cfg);
    }

    // process the aggregate "all" configs (if any)
    const allConfigs = configs.filter((c) => String(c.league).toLowerCase() === "all");
    for (const aCfg of allConfigs) {
      await processAllAggregate(aCfg);
    }

    // close stats connection
    try {
      await statsConn.close();
    } catch (e) {
      // ignore
    }

    // Create clean embed summary
    const embed = new EmbedBuilder()
      .setTitle("✅ Top Players Update Complete")
      .setColor(0x00ff00)
      .setTimestamp();

    // Add updated section if any
    if (results.updated.length > 0) {
      embed.addFields({
        name: "🔄 Updated Lists",
        value: results.updated.map(item => `• ${item}`).join("\n") || "None"
      });
    }

    // Add created section if any
    if (results.created.length > 0) {
      embed.addFields({
        name: "🆕 Created Lists",
        value: results.created.map(item => `• ${item}`).join("\n") || "None"
      });
    }

    // If nothing was updated or created
    if (results.updated.length === 0 && results.created.length === 0) {
      embed.setDescription("No lists were updated or created.");
    }

    // Update or send the embed (only one response)
    try {
      if (statusMsg && statusMsg.edit) {
        await statusMsg.edit({ content: "", embeds: [embed] });
      } else {
        await message.reply({ embeds: [embed] });
      }
    } catch (e) {
      // Fallback to simple message
      const summary = "✅ Top Players Update Complete";
      if (statusMsg && statusMsg.edit) {
        await statusMsg.edit(summary);
      } else {
        await message.reply(summary);
      }
    }
  },
};