import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./db.js";
import { Client, GatewayIntentBits } from "discord.js";

// Import functions
import { log, initLogger } from "./functions/log.js";

// Import command functions
import { getCommandsObject } from "./commands/index.js";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX = ":?";

// Allowed servers
const allowedGuilds = [
  "759870262262628352", // my server
  "1257473566325084310", // SPL server
];

// Load commands into memory
client.commands = getCommandsObject();

// ===========================
//        Client Ready
// ===========================
client.once("clientReady", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  // Leave unauthorized guilds
  c.guilds.cache.forEach((guild) => {
    if (!allowedGuilds.includes(guild.id)) {
      console.log(`🚪 Leaving unauthorized guild: ${guild.name}`);
      guild.leave();
    }
  });

  // Initialize logger
  initLogger(c);
});

// ===========================
//         Guild Join
// ===========================
client.on("guildCreate", (guild) => {
  if (!allowedGuilds.includes(guild.id)) {
    console.log(`🚪 Joined unauthorized guild: ${guild.name}, leaving...`);
    guild.leave();
  }
});

// ===========================
//      Prefix Commands
// ===========================
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (!allowedGuilds.includes(message.guild.id)) return;
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    if (message.content === "log") {
      log("hello world");
    }

    const args = message.content
      .slice(PREFIX.length)
      .trim()
      .split(/ +/);

    // Longest-match command resolution
    let command;
    for (let len = args.length; len > 0; len--) {
      const potentialName = args.slice(0, len).join(" ").toLowerCase();
      if (client.commands[potentialName]) {
        command = client.commands[potentialName];
        args.splice(0, len);
        break;
      }
    }

    if (command) {
      await command.run({ message, args });
    }
  } catch (err) {
    console.error("❌ Error in prefix handler:", err);
  }
});

// ===========================
//    Slash & Autocomplete
// ===========================
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return;
    if (!allowedGuilds.includes(interaction.guild.id)) return;

    if (interaction.isAutocomplete()) {
      const command = client.commands[interaction.commandName];
      if (command?.autocomplete) {
        return command.autocomplete({ interaction });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands[interaction.commandName];
    if (command) {
      await command.run({ interaction });
    }
  } catch (err) {
    console.error("❌ Error in interaction handler:", err);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "⚠️ Something went wrong. Check console logs.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "⚠️ Something went wrong. Check console logs.",
          ephemeral: true,
        });
      }
    } catch (e) {
      console.error("❌ Failed to send error reply:", e);
    }
  }
});

// ===========================
//          Bot Login
// ===========================
(async () => {
  await connectDB();
  client.login(process.env.BOT_TOKEN);
})();
