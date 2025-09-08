import { EmbedBuilder } from "discord.js";

export default class Channel {
  constructor(client, url) {
    if (!client) throw new Error("Channel requires a Discord client.");
    this.client = client;
    this.channelId = String(url).split("/").pop();
    this.channel = null;
  }

  async init() {
    try {
      // Fetch the channel object (works for TextChannel, NewsChannel, Threads)
      this.channel = await this.client.channels.fetch(this.channelId);

      // Some channel types (like voice) can't send messages
      if (!this.channel || typeof this.channel.send !== "function") {
        throw new Error("Invalid or non-text channel.");
      }
    } catch (err) {
      console.error("Failed to fetch channel:", err);
      this.channel = null;
    }
  }

  async sendMsg(message) {
    if (!this.channel) {
      await this.init();
    }
    if (!this.channel) {
      throw new Error("Channel not initialized or invalid.");
    }
    return this.channel.send(
      typeof message === "string" ? message : String(message)
    );
  }

  /**
   * sendEmbed(title, msg, options)
   *
   * title: string
   * msg: string (description)
   * options: {
   *   color: number | hex (default: 0x2b2d31),
   *   thumbnail: string (url),
   *   fields: Array<{ name, value, inline }>,
   *   footer: { text, iconURL },
   * }
   */
  async sendEmbed(title, msg, options = {}) {
    if (!this.channel) {
      await this.init();
    }
    if (!this.channel) {
      throw new Error("Channel not initialized or invalid.");
    }

    const embed = new EmbedBuilder()
      .setTitle(title || "")
      .setDescription(msg || "")
      .setColor(options.color ?? 0x2b2d31) // darkish default
      .setTimestamp();

    // Author: bot name + avatar (gives the little icon on the left)
    try {
      const botUser = this.client.user;
      if (botUser) {
        embed.setAuthor({
          name: botUser.username,
          iconURL: botUser.displayAvatarURL?.({ extension: "png", size: 64 }),
        });
      }
    } catch (e) {
      // ignore author set failure
    }

    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (Array.isArray(options.fields)) embed.addFields(options.fields);
    if (options.footer) embed.setFooter(options.footer);

    return this.channel.send({ embeds: [embed] });
  }
}
