# Vercel Eve as the agent framework

The PoC needs two durable flows (Discovery and Extraction), human schema validation for administrators, subagents for schema proposal and extraction, and deployability on Vercel. We chose **Vercel Eve** over a plain Next.js + AI SDK app because Eve provides filesystem-first agent composition, human-in-the-loop gates, subagents, and Workflow-backed sessions out of the box.

**Considered options:** Plain Next.js API routes with Vercel AI SDK (simpler, but no durable admin workflow or HITL); LangChain/LangGraph (heavier glue). Eve was selected because it matches the two-flow design and deploys unchanged via `vercel deploy`.

**Consequences:** Team must learn Eve conventions (`agent/`, tools, subagents, channels). Model calls still route through AI Gateway. Swapping Eve later would require reimplementing HITL and session durability.
