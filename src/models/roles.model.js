import { Schema, model } from "mongoose";

const rolesSchema = new Schema(
  {
    type: { type: String, required: true }, // e.g., "manager"
    roleId: { type: String, required: true },
  },
  { strict: true }
);

export default model("roles", rolesSchema, "roles");
