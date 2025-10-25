import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import playerSchema from "./playerSchema.js";

// boilerplate for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load env (3 folders up from /models/)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// stats DB connection
export const statsConnection = mongoose.createConnection(process.env.MONGODB_STATS_URI, {
  dbName: "stats",
});

// prevent mongoose from pluralizing collection names
mongoose.pluralize(null);

const LaLiga = statsConnection.model("LaLiga", playerSchema, "LaLiga");
const PL = statsConnection.model("PL", playerSchema, "PL");
const SerieA = statsConnection.model("SerieA", playerSchema, "SerieA");
const Ligue1 = statsConnection.model("Ligue1", playerSchema, "Ligue1");
const Bundesliga = statsConnection.model("Bundesliga", playerSchema, "Bundesliga");

export const models = {
  "la-liga": LaLiga,
  pl: PL,
  "serie-a": SerieA,
  "ligue-1": Ligue1,
  bundesliga: Bundesliga,
};
