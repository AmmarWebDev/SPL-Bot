import { Schema, model } from "mongoose";

const channelsSchema = new Schema(
  {
    type: { type: String, required: true }, // e.g. "logs", "top-players"

    // Only used for type = "top-players"
    league: { type: String },
    resultChannelUrl: { type: String }, // URL of results channel
    url: { type: String }, // URL of top players channel
  },
  { strict: false }
);

export default model("channels", channelsSchema, "channels");
