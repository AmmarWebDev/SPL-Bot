import mongoose from "mongoose";

const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  goals: { type: Number, default: 0 },
  assists: { type: Number, default: 0 },
  cleansheets: { type: Number, default: 0 },
  teamId: { type: String, default: null },
});

export default playerSchema;
