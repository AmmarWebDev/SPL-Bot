import mongoose from "mongoose";
import Channel from "../classes/Channel.js";

/**
 * This logger:
 * - reads channel URLs from the `channels` collection (documents with `type` and `url`)
 * - builds Channel instances for 'logs' and 'transfers'
 *
 * Usage:
 *  - In main.js inside client.once('clientReady', async (c) => { await initLogger(c); ... })
 *  - Then call: log("Title", "Message body") OR log("Just a message")
 */

let logsChannel = null;
let transfersChannel = null;

// Lightweight model for your 'channels' collection (strict:false to accept existing doc shape)
const ChannelsModel =
  mongoose.models._channels ||
  mongoose.model(
    "_channels",
    new mongoose.Schema({}, { strict: false }),
    "channels"
  );

/**
 * Initialize logger (fetch channel URLs from DB and create Channel instances)
 * Call this once after your mongoose.connect() and after the Discord client is ready.
 */
export async function initLogger(client) {
  if (!client) {
    console.error("initLogger requires a Discord client.");
    return;
  }

  try {
    // Get records for logs & transfers (change query if you use different type names)
    const records = await ChannelsModel.find({
      type: { $in: ["logs", "transfers"] },
    }).lean();

    const logsRec = records.find((r) => r.type === "logs");
    const transfersRec = records.find((r) => r.type === "transfers");

    if (logsRec && logsRec.url) {
      logsChannel = new Channel(client, logsRec.url);
      // init in background but await so it's ready for immediate logging
      await logsChannel.init();
    } else {
      console.warn("No 'logs' channel record found in DB.");
    }

    if (transfersRec && transfersRec.url) {
      transfersChannel = new Channel(client, transfersRec.url);
      await transfersChannel.init();
    } else {
      console.warn("No 'transfers' channel record found in DB.");
    }
  } catch (err) {
    console.error("❌ Failed to initialize logger channels from DB:", err);
  }
}

/**
 * log(title, msg)
 * - If called with two arguments, sends an embed with title & msg.
 * - If called with a single argument, sends a plain text message.
 *
 * Backwards compatible: previous calls like log("hello world") still work.
 */
export async function log(titleOrMsg, maybeMsg) {
  try {
    if (!logsChannel) {
      console.error(
        "❌ Logger not initialized. Call initLogger(client) first."
      );
      return;
    }

    // Two-arg form => embed
    if (typeof maybeMsg !== "undefined") {
      const title = String(titleOrMsg ?? "");
      const msg = String(maybeMsg ?? "");
      // Basic embed look; you can extend options if needed
      return await logsChannel.sendEmbed(title, msg, {
        color: 0x2b2d31,
      });
    }

    // Single-arg form => plain text
    const msg = String(titleOrMsg ?? "");
    return await logsChannel.sendMsg(msg);
  } catch (err) {
    console.error("❌ Failed to send log message:", err);
  }
}

/**
 * Optionally export transfersChannel or helper for sending transfer logs.
 */
export async function transferLog(titleOrMsg, maybeMsg) {
  try {
    if (!transfersChannel) {
      console.error("❌ Transfers logger not initialized.");
      return;
    }

    if (typeof maybeMsg !== "undefined") {
      return await transfersChannel.sendEmbed(
        String(titleOrMsg),
        String(maybeMsg),
        {
          color: 0x2b2d31,
        }
      );
    }
    return await transfersChannel.sendMsg(String(titleOrMsg));
  } catch (err) {
    console.error("❌ Failed to send transfer message:", err);
  }
}
