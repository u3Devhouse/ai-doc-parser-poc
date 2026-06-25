import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.EVE_MODEL ?? "openai/gpt-4o-mini",
});
