# PRD: Conversational Discovery Session

**Status:** Approved for implementation  
**Design:** [DISCOVERY_SESSION_DESIGN.md](./DISCOVERY_SESSION_DESIGN.md)  
**ADR:** [0006-conversational-discovery-with-ai-sdk.md](./adr/0006-conversational-discovery-with-ai-sdk.md)  
**Glossary:** [CONTEXT.md](../CONTEXT.md)

## Problem Statement

Schema Administrators reviewing unknown Source Documents need more than a one-shot Schema Proposal. Real discovery work is iterative: the model may propose fields that are not on the document, or place fields on the wrong Document Side. Today the Admin Discovery UI supports upload → table edit → approve only. That misses Document Summary context, Schema Refinement conversation, and Document Re-review against Cached Source Documents.

## Solution

Introduce a **Discovery Session** as the unit of work for admin discovery. Each session caches Source Files, stores a Document Summary, maintains a draft schema, records conversation history, and supports explicit Document Re-review before Human Validation completes. Schema Administrators converse in natural language; the AI applies schema mutations via tools. The field table and chat stay in sync. Approve & Extract and Save to Library behave as today and delete the session.

## User Stories

1. As a Schema Administrator, I want a short Document Summary after upload, so that I can trust what the system saw before debating fields.
2. As a Schema Administrator, I want an initial Schema Proposal with all fields optional, so that I can refine rather than rebuild from scratch.
3. As a Schema Administrator, I want to chat in natural language about the draft schema, so that I can remove hallucinated fields and correct placement without manual JSON editing.
4. As a Schema Administrator, I want the AI to apply schema changes via structured tools, so that mutations are predictable and testable.
5. As a Schema Administrator, I want the field table to reflect chat tool changes immediately, so that I can verify the draft visually.
6. As a Schema Administrator, I want manual table edits to persist to the session, so that chat and table edits share one draft.
7. As a Schema Administrator, I want a Re-read document action, so that vision re-runs against Cached Source Documents without re-uploading.
8. As a Schema Administrator, I want Document Re-review to use the current draft and recent conversation, so that structural corrections inform the new proposal.
9. As a Schema Administrator, I want a revision counter, so that I know how many re-reviews occurred.
10. As a Schema Administrator, I want pending sessions listed, so that I can resume work across uploads.
11. As a Schema Administrator, I want Approve & Extract unchanged in outcome, so that existing extraction validation still applies.
12. As a Schema Administrator, I want Save to Library unchanged in outcome, so that approved templates land in the Schema Library Store.
13. As a Schema Administrator, I want the session deleted on approve, so that Cached Source Documents are not retained (ADR-0003).
14. As a developer, I want chat on `streamText` and proposal/revise on `generateObject`, so that conversation and structure extraction use the right AI SDK primitives.
15. As a developer, I want admin-only chat routes, so that end users on `/` keep one-shot discovery fallback.
16. As a developer, I want HTTP handler tests with mocked AI SDK, so that session persistence and tool mutations are verified without live models.
17. As a Schema Administrator, I want shadcn-based chat UI, so that the admin experience matches project UI conventions.
18. As a Schema Administrator, I want to mark fields required in the table before approve, so that Human Validation includes required-field decisions.
19. As a Schema Administrator, I want paired identity drafts to support per-side field tools, so that front/back corrections are precise.
20. As a developer, I want Next.js 16, so that the app stays on a supported framework version.

## Implementation Decisions

- **Session identity:** Reuse `proposalId` as the Discovery Session id; extend the proposal store record shape.
- **Persistence fields:** `documentSummary`, `messages[]`, `revisionCount`, plus existing proposal and cached files.
- **Step 1 (summary):** `generateText` with vision content from cached upload buffers.
- **Step 2 (proposal):** `generateObject` with existing proposal Zod shape; all fields optional.
- **Chat route:** `POST /api/discover/:id/chat` — `streamText` + tools (`addField`, `removeField`, `updateField`, `setTemplateKey`, `setPaired`, `setCategory`); persist messages and draft on finish.
- **Revise route:** `POST /api/discover/:id/revise` — `generateObject` from cached files + draft + recent messages; increment `revisionCount`.
- **GET session:** `GET /api/discover/:id` returns proposal, summary, messages, revision count.
- **Draft sync:** `PATCH /api/discover/:id` for manual table edits (required by table/chat sync).
- **Frontend:** `@ai-sdk/react` `useChat` in admin page; Document Summary card; Re-read document button.
- **Framework:** Upgrade to Next.js 16.x; move `serverActions` out of `experimental` in Next config.

## Testing Decisions

- Test **external behavior** at the handler seam (`handleDiscover`, `handleGetProposal`, `handleChat`, `handleRevise`, `handleUpdateDraft`), not AI SDK internals.
- Mock `generateText`, `generateObject`, and `streamText` via `AiOverrides`.
- Prior art: `tests/discover.test.ts`, `tests/api-handlers.test.ts`.
- Schema tool pure functions tested separately (`applyAddField`, `applyRemoveField`, etc.).
- TDD flow per vertical slice: red test for session field → implement store/handler → green.
- Run `pnpm test`, `pnpm typecheck`, `pnpm build` before merge.

## Out of Scope

- End-user conversational discovery on `/`
- Multi-document batch discovery
- Long-term audit log of conversations
- Eve subagent orchestration for chat
- Auto re-review after tool batches (config flag deferred)
- Auto-save partial sessions to library without explicit approve

## Further Notes

- Ephemeral extraction (ADR-0003) still applies: only `data/templates/` is long-lived.
- Document Summary is admin-visible only; not stored on the saved Template.
- Guatemala DPI is the reference manual test scenario from the design doc.
