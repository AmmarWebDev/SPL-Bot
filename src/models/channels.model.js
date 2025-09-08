import { Schema, model } from "mongoose";

const channelsSchema = new Schema(
  {
    type: { type: String, required: true }, // e.g., "logs"
    url: { type: String, required: true }, // full Discord channel URL
  },
  { strict: true }
);

export default model("channels", channelsSchema, "channels");
