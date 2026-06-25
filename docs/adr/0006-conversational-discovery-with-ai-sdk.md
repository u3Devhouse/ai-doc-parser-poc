# Conversational Discovery via Vercel AI SDK

Discovery Flow today is one-shot: propose schema, edit a table, approve. Schema Administrators need to iterate in natural language (“this field is not on the document”, “move expiration to the back”) and optionally re-read the cached Source File when the draft structure changes.

We extend Discovery Sessions with a **streaming chat route** using Vercel AI SDK (`streamText` + schema mutation tools) while keeping **initial proposal and document re-review** on `generateObject` against cached session files. Conversation state and draft schema persist in the existing filesystem proposal store until approve deletes the session.

**Consequences:** Admin UI gains a chat panel (`@ai-sdk/react`). New routes `/api/discover/:id/chat` and `/api/discover/:id/revise`. Eve is not required for chat orchestration in the PoC — routes call AI Gateway directly, same as extraction.
