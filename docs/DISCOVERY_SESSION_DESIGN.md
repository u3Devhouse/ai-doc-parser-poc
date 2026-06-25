# Discovery Session Design

**Status:** Proposed — awaiting approval before PRD / issues / TDD  
**Parent glossary:** [CONTEXT.md](../CONTEXT.md)  
**Related ADR:** [0006-conversational-discovery-with-ai-sdk.md](./adr/0006-conversational-discovery-with-ai-sdk.md)

---

## Problem

The current Admin Discovery UI is **one-shot**: upload → single Schema Proposal → manual table edits → approve. That matches steps 1–2 of discovery but not the iterative loop a Schema Administrator needs when the model proposes fields that do not exist on the document (e.g. blood type on Guatemala DPI) or misplaces them (expiration date on front instead of back).

Production discovery should resemble how the prior session corrected DPI: **review the document, propose structure, converse about what belongs, re-read the cached document when the structure changes, then save the template**.

## Target flow (agent behavior)


| Step                         | Actor                     | Behavior                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Review document           | System                    | Analyze uploaded Source File(s) with vision (PDF pages rasterized; images sent directly). Produce a short **Document Summary** (category, layout, sides, notable labels) shown to the admin.                                             |
| 2. Propose structure         | System                    | Emit initial **Schema Proposal** (`templateKey`, `category`, `paired`, fields / sides). All fields start optional.                                                                                                                       |
| 3. Refine via conversation   | Schema Administrator + AI | Chat about what should or should not exist. Admin uses natural language (“remove blood type”, “expiration is on the back”). AI applies changes via **schema tools** and explains rationale.                                              |
| 4. Re-review cached document | System (on demand)        | When admin asks to “check the document again” or after structural changes, re-run vision against **cached Source Files** from the Discovery Session plus current draft schema and conversation context. Update proposal fields in place. |
| 5. Complete                  | Schema Administrator      | **Approve & Extract** (verify against real content) and/or **Save to Library** (persist Template to Schema Library Store). Session and cached files are removed.                                                                         |


## Recommendations (accepted)

### R1 — Introduce **Discovery Session** as the unit of work

A Discovery Session bundles:

- Cached Source Files (already in `proposal-store`)
- Current draft Schema Proposal
- Document Summary from step 1
- Conversation transcript (user + assistant messages)
- Revision counter (increments on each document re-review)

The existing `proposalId` becomes the session id. No separate id space.

### R2 — Keep document cache **session-scoped**, not library-scoped

Aligns with ADR-0003 (Ephemeral Extraction). Source Files live on disk only under `data/proposals/` until approve or explicit discard. Approve deletes the session file as today.

### R3 — Use **Vercel AI SDK** for conversation; keep **generateObject** for structure extraction

- **Conversation:** `streamText` + tools (`addField`, `removeField`, `updateField`, `setTemplateKey`, `setPaired`, `setCategory`)
- **Initial proposal & re-review:** `generateObject` with Zod schema (same shape as today’s `proposeSchema`)
- **UI:** `@ai-sdk/react` `useChat` pointed at a streaming chat route

Rationale: chat handles ambiguity; structured generation handles schema shape. Mixing both in one `generateObject` call on every message is brittle.

### R4 — Re-review always uses **cached files**, never re-upload

The admin does not re-upload between iterations. `GET` proposal already implies cached buffers; re-review loads them from `proposal-store` and passes rendered page images + current draft + recent conversation summary to the discovery model.

### R5 — Human Validation remains **admin-only**; chat is not end-user facing

End users on `/` still get one-shot discovery fallback → pending proposal. Only `/admin` gets the conversational UI.

### R6 — Field table stays editable; chat and table stay in sync

Tool calls update the same draft schema the table renders. Manual table edits update draft without chat. Both paths persist to the session record on change.

### R7 — Document Summary is user-visible context, not a persisted Template field

Short markdown shown above the chat (“2-page identity document, Spanish labels, paired front/back”). Helps the admin trust step 1 before debating fields.

### R8 — Re-review triggers

- Explicit admin action: **“Re-read document”** button
- Optional: auto re-review after tool batch that adds ≥1 field (config flag, default off for PoC)

### R9 — Approve path unchanged in outcome

`POST /api/discover/:id/approve` still accepts edited `template`, runs Structured Extraction against cached files, optionally saves to `data/templates/`. Response shape unchanged.

### R10 — Testing seam: HTTP API with mocked AI SDK

Same as existing PRD testing decisions. Chat stream can be tested via handler that returns full text in test mode; tools tested through session state after mocked tool execution.

## API surface (new / changed)


| Method | Path                        | Purpose                                                                                                  |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/discover`             | **Unchanged entry.** Creates session, runs steps 1–2, returns proposal + `documentSummary`.              |
| `GET`  | `/api/discover`             | List pending sessions (unchanged).                                                                       |
| `GET`  | `/api/discover/:id`         | **Extended.** Returns proposal, `documentSummary`, `messages`, draft schema.                             |
| `POST` | `/api/discover/:id/chat`    | **New.** Streaming chat; tools mutate draft schema; persists messages + schema.                          |
| `POST` | `/api/discover/:id/revise`  | **New.** Re-run vision + `generateObject` from cached files + draft + summary; returns updated proposal. |
| `POST` | `/api/discover/:id/approve` | Unchanged contract.                                                                                      |


## UI layout (Admin Discovery)

```
┌─────────────────────────────────────────────────────────┐
│ Pending sessions list                                    │
├──────────────────────┬──────────────────────────────────┤
│ Document summary     │ Schema field table (editable)    │
│ (step 1 output)      │                                  │
├──────────────────────┴──────────────────────────────────┤
│ Chat panel (useChat)          [Re-read document]         │
├─────────────────────────────────────────────────────────┤
│ [Approve & Extract]  [Save to Library]                   │
└─────────────────────────────────────────────────────────┘
```

Use shadcn/ui: `Card`, `ScrollArea`, `Button`, `Input`, `Textarea` for chat.

## Session persistence shape (proposal record extension)

```json
{
  "proposal": { "proposalId": "prop_…", "proposedTemplateKey": "…", "…": "…" },
  "documentSummary": "2-page Guatemala DPI scan. Front: photo, CUI, apellidos…",
  "messages": [
    { "role": "user", "content": "Blood type is not on this document" },
    { "role": "assistant", "content": "Removed tipo_sangre from back fields." }
  ],
  "revisionCount": 1,
  "files": [ "…" ],
  "createdAt": "…",
  "source": "admin"
}
```

## Out of scope for this design

- End-user conversational discovery on `/`
- Multi-document batch discovery
- Long-term audit log of conversations
- Eve subagent orchestration for chat (direct AI SDK in route handlers for PoC)
- Auto-save partial sessions to library without explicit approve

## Success criteria

1. Admin uploads Guatemala DPI PDF → sees summary + initial proposal.
2. Admin chats “remove blood type; expiration is on the back, front date is photo taken” → draft schema updates via tools.
3. Admin clicks **Re-read document** → proposal reflects document with corrected field placement.
4. Admin saves → `data/templates/identity/GT/dpi.json` (or new key) matches conversation outcome.
5. Approve deletes session; no Source File bytes left in `data/proposals/`.

## Approval checklist

- [x] Flow steps 1–5 match expected agent discovery behavior
- [x] API surface acceptable
- [x] AI SDK split (chat tools vs generateObject revise) acceptable
- [x] Session-scoped file cache acceptable
- [x] Ready to proceed to PRD → issues → TDD