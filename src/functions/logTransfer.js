import channelsSchema from "../models/channels.model.js";
import { EmbedBuilder } from "discord.js";

/**
 * logTransfer(client, player, teamRole, actor, action = "sign")
 * - client: Discord client (required)
 * - player: User object
 * - teamRole: Role object
 * - actor: User object (who performed the action)
 * - action: "sign" | "release" | "demand" | "promotion" | "demotion" (default "sign")
 */
export async function logTransfer(
  client,
  player,
  teamRole,
  actor,
  action = "sign"
) {
  try {
    if (!client) {
      console.error("logTransfer: no client provided.");
      return;
    }

    const transferChannelDoc = await channelsSchema.findOne({
      type: "transfers",
    });
    if (!transferChannelDoc) {
      console.error("❌ No transfers channel set in DB.");
      return;
    }

    // Accept channelId, url, or id
    let raw =
      transferChannelDoc.channelId ||
      transferChannelDoc.url ||
      transferChannelDoc.id;
    if (!raw) {
      console.error(
        "❌ transfers document missing channelId/url/id:",
        transferChannelDoc
      );
      return;
    }

    // Extract channelId if needed
    let channelId = raw;
    if (!/^\d{16,21}$/.test(String(raw))) {
      const matches = String(raw).match(/\d{16,21}/g);
      if (matches && matches.length) channelId = matches[matches.length - 1];
      else {
        console.error(
          "❌ Could not extract a channel ID from transfers doc value:",
          raw
        );
        return;
      }
    }

    // Fetch channel
    let channel;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (err) {
      console.error("❌ Could not fetch transfers channel:", channelId, err);
      return;
    }

    if (
      !channel ||
      (typeof channel.send !== "function" && !channel.isTextBased?.())
    ) {
      console.error("❌ transfers channel is not a text channel:", channelId);
      return;
    }

    // Determine embed title, description, and actor label
    let title = "🔁 Transfer Completed";
    let description = `${player} has joined ${teamRole}!`;
    let actorLabel = "Signed by";
    let color = 0x3498db;

    switch (action.toLowerCase()) {
      case "release":
        title = "🔻 Player Released";
        description = `${player} has been released from ${teamRole}!`;
        actorLabel = "Released by";
        color = 0xe74c3c;
        break;
      case "demand":
        title = "🔴 Transfer Demand";
        description = `${player} has requested release from ${teamRole}!`;
        actorLabel = "Requested by";
        color = 0xe67e22;
        break;
      case "promotion":
        title = "📈 Player Promoted";
        description = `${player} has been promoted to ${teamRole}!`;
        actorLabel = "Promoted by";
        color = 0x2ecc71;
        break;
      case "demotion":
        title = "📉 Player Demoted";
        description = `${player} has been demoted from ${teamRole}!`;
        actorLabel = "Demoted by";
        color = 0xf1c40f;
        break;
      // default is "sign"
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .addFields(
        { name: "Player", value: `<@${player.id}>`, inline: true },
        { name: "Team", value: `<@&${teamRole.id}>`, inline: true },
        {
          name: actorLabel,
          value: actor ? `<@${actor.id}>` : "Unknown",
          inline: true,
        }
      )
      .setColor(color)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`✅ Transfer logged (${action}) to channel`, channelId);
  } catch (err) {
    console.error("❌ Failed to log transfer:", err);
  }
}
