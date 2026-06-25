import { defineAgent } from "eve";

export default defineAgent({
  description: "Analyzes document images and proposes extraction schema fields",
  model: process.env.DISCOVERY_MODEL ?? "openai/gpt-4o",
});
