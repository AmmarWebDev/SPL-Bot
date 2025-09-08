// src/models/teams.model.js
import { Schema, model } from "mongoose";

const teamsSchema = new Schema(
  {
    roleId: { type: String, required: true }, // Discord role ID
    emoji: { type: String, required: true }, // e.g., ":Barca:"
  },
  { strict: true }
);

export default model("teams", teamsSchema, "teams");
