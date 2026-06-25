import { defineAgent } from "eve";

export default defineAgent({
  description: "Runs structured extraction against an approved template",
  model: process.env.EXTRACTION_MODEL ?? "openai/gpt-4o",
});
