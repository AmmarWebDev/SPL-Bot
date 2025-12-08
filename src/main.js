import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./db.js";

import {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
} from "discord.js";

// ===========================
//      Import Functions
// ===========================
import { log, initLogger } from "./functions/log.js";

// ===========================
//       Import Commands
// ===========================
import check from "./commands/utils/check.js";
import viewmembers from "./commands/mod/viewmembers.js";
import recordStats from "./commands/stats/recordStats.js";
import teamsView from "./commands/teams/teams-view.js";
import teamAdd from "./commands/teams/team-add.js";
import teamDelete from "./commands/teams/team-delete.js";
import teamSetEmoji from "./commands/teams/team-set-emoji.js";
import appoint from "./commands/teams/appoint.js";
import sign from "./commands/teams/sign.js";
import release from "./commands/teams/release.js";
import demand from "./commands/teams/demand.js";
import promote from "./commands/teams/promote.js";
import demote from "./commands/teams/demote.js";
import rosters from "./commands/teams/rosters.js";
import managerList from "./commands/teams/manager-list.js";
import disband from "./commands/teams/disband.js";
import singleRecord from "./commands/stats/singleRecord.js";
import bulkRecord from "./commands/stats/bulkRecord.js";
import setTopPlayers from "./commands/stats/setTopPlayers.js";
import updateTopPlayers from "./commands/stats/updateTopPlayers.js";

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

// Store commands
client.commands = new Collection();
[
  check,
  viewmembers,
  recordStats,
  teamsView,
  teamAdd,
  teamDelete,
  teamSetEmoji,
  appoint,
  sign,
  release,
  demand,
  promote,
  demote,
  rosters,
  managerList,
  disband,
  singleRecord,
  bulkRecord,
  setTopPlayers,
  updateTopPlayers
].forEach((cmd) => client.commands.set(cmd.name.toLowerCase(), cmd));

// ===========================
//   Register Slash Commands
// ===========================
const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
const CLIENT_ID = process.env.CLIENT_ID; // <-- Add this to your .env

client.once("clientReady", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  // Leave unauthorized guilds
  c.guilds.cache.forEach((guild) => {
    if (!allowedGuilds.includes(guild.id)) {
      console.log(`Leaving unauthorized guild: ${guild.name}`);
      guild.leave();
    }
  });

  // Initialize logger (creates Channel instances with the ready client)
  initLogger(c);

  // Build slash command JSON array
  const commandsBody = [check, viewmembers, recordStats].map((cmd) =>
    cmd.data.toJSON()
  );

  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commandsBody,
    });
    console.log("✅ Global slash commands registered!");
  } catch (error) {
    console.error("❌ Failed to register slash commands:", error);
  }
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
    if (message.content === "log") {
      log("hello world");
    }
    if (!message.guild) return;
    if (!allowedGuilds.includes(message.guild.id)) return;
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);

    // Try to find the longest matching command name
    let command;
    for (let len = args.length; len > 0; len--) {
      const potentialName = args.slice(0, len).join(" ").toLowerCase();
      if (client.commands.has(potentialName)) {
        command = client.commands.get(potentialName);
        args.splice(0, len); // remove command words from args
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
      const command = client.commands.get(interaction.commandName);
      if (command && typeof command.autocomplete === "function") {
        return command.autocomplete({ interaction });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
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
  await connectDB(); // connect to database first
  client.login(process.env.BOT_TOKEN);
})();
