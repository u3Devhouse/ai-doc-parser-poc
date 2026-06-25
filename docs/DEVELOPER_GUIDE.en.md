# Developer Implementation Guide (English)

This guide explains how to implement the Document Extraction PoC for developers joining the project.

## Related documents

| Document | Purpose |
|----------|---------|
| [CONTEXT.md](../CONTEXT.md) | Domain glossary |
| [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md) | Models, env vars, infra |
| [POC_GUIDE.md](./POC_GUIDE.md) | End-to-end usage walkthrough |
| [PRD_DISCOVERY_SESSION.md](./PRD_DISCOVERY_SESSION.md) | Conversational Discovery Session PRD |
| [DISCOVERY_SESSION_DESIGN.md](./DISCOVERY_SESSION_DESIGN.md) | Discovery Session design |

---

## Quick start

```bash
# If cloning this repo (skip init):
pnpm install
cp .env.example .env.local
pnpm dev
```

For a **fresh scaffold** (see [POC_GUIDE.md](./POC_GUIDE.md)):

```bash
npx eve@latest init document-extraction-poc --channel-web-nextjs
cd document-extraction-poc
pnpm install
cp .env.example .env.local
pnpm dev
```

| URL | Purpose |
|-----|---------|
| `http://localhost:3000` | Upload UI |
| `http://localhost:3000/admin` | Discovery Session admin (requires `ADMIN_API_KEY`) |

**Local dev without a Gateway key:** keep `AI_GATEWAY_MOCK=true` in `.env.local` (default in `.env.example`). Set `AI_GATEWAY_MOCK=false` and `AI_GATEWAY_API_KEY` for real model calls.

```bash
pnpm test        # 62+ integration/unit tests (mock mode)
pnpm typecheck
pnpm build
```

**Shipped templates:** `identity/GT/dpi` (paired Guatemala DPI), `contract/nda`. Copy [data/templates/_example.template.json](../data/templates/_example.template.json) for new types.

---

## Project structure

```
document-extraction-poc/
├── app/                             # Next.js 16 App Router
│   ├── page.tsx                     # Upload UI
│   ├── admin/page.tsx               # Schema administrator UI (chat + summary)
│   ├── layout.tsx
│   └── api/
│       ├── extract/route.ts         # POST extraction / discovery redirect
│       └── discover/
│           ├── route.ts             # POST discover, GET list
│           └── [id]/
│               ├── route.ts         # GET session, PATCH draft
│               ├── chat/route.ts    # Streaming schema refinement
│               ├── revise/route.ts  # Document re-review
│               └── approve/route.ts
├── agent/                           # Eve scaffold (instructions, subagents, tools)
│   ├── agent.ts
│   ├── instructions.md
│   ├── channels/eve.ts              # Eve HTTP channel + OIDC auth
│   ├── subagents/                   # schema_discovery, document_extractor
│   └── tools/                       # validate_match, extract_structured, save_template, …
├── components/
│   ├── admin/discovery-chat-panel.tsx
│   └── ui/                          # shadcn/ui primitives (button, card, input, …)
├── lib/
│   ├── template-store.ts            # Schema library (`data/templates/`)
│   ├── proposal-store.ts            # Discovery Session persistence (`data/proposals/`)
│   ├── schema.ts                    # Zod builders (strict + relaxed extraction)
│   ├── extraction.ts                # AI Gateway calls (classify, extract, propose)
│   ├── extract-handler.ts           # POST /api/extract orchestration
│   ├── discover-handler.ts          # Discovery HTTP handlers + chat
│   ├── discovery-schema-tools.ts    # Chat schema mutation tools
│   ├── extraction-prompt.ts         # Field-aware extraction prompts
│   ├── pdf.ts                       # In-memory PDF → page images
│   ├── upload.ts                    # Multipart parse + validation
│   ├── auth.ts                      # ADMIN_API_KEY bearer check
│   ├── ai-mock.ts                   # Deterministic mock when AI_GATEWAY_MOCK=true
│   ├── resolve-ai-overrides.ts      # Wires mock vs real Gateway
│   ├── ai-route-errors.ts           # Gateway error → JSON responses
│   ├── api-client.ts                # Admin UI fetch helpers
│   └── types.ts
├── data/
│   ├── templates/                   # Persisted schema library only
│   └── proposals/                   # Ephemeral discovery sessions (deleted on approve)
├── tests/                           # vitest (API, extraction, paired identity, …)
├── docs/
├── .env.example
├── next.config.ts
├── vercel.json
└── package.json                     # pnpm; Node 24.x
```

### Runtime architecture (important)

HTTP routes call **`lib/*` handlers + Vercel AI SDK** (`generateObject`, `streamText`, `gateway()` from `@ai-sdk/gateway`) directly — not the Eve agent runtime. The `agent/` tree is the **Eve scaffold** (`npx eve@latest init`) and documents intended orchestration; discovery chat and extraction are implemented in Next.js API routes per [ADR 0006](./adr/0006-conversational-discovery-with-ai-sdk.md). Eve subagents/tools remain available for `eve dev` or a future migration to Workflow-backed sessions.

---

## Environment variables

See `.env.example`. Minimum for local dev:

| Variable | Purpose |
|----------|---------|
| `AI_GATEWAY_MOCK` | `true` = no API key; deterministic mock JSON |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (or OIDC on Vercel deploy) |
| `ADMIN_API_KEY` | Bearer token for `/admin` and `/api/discover/*` |
| `EXTRACTION_PIPELINE` | `auto` (default), `single`, or `two-stage` |
| `EXTRACTION_TWO_STAGE_FIELD_THRESHOLD` | Force two-stage when field count exceeds threshold (default 15) |
| `TEMPLATE_STORE_PATH` | Schema library root (default `data/templates`) |
| `PROPOSAL_STORE_PATH` | Discovery session cache (default `data/proposals`) |

Model overrides: `DISCOVERY_MODEL`, `EXTRACTION_MODEL`, `VISION_MODEL`, `STRUCTURE_MODEL`, `CLASSIFICATION_MODEL`. Full list: [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md).

---

## Core domain rules (implementation contract)

Implement exactly as defined in `CONTEXT.md`:

1. **Discovery Flow** when no library template and no `templateKey`.
2. **Extraction Flow** when template exists or `templateKey` provided.
3. **Specified `templateKey`** → skip discovery; return **422** on mismatch.
4. **No library template** (no `templateKey`) → discovery (not confidence-based fallback).
5. **Single upload** per document; retry discards previous attempt.
6. **Paired identity** parent keys require all sides readable or reject entire upload.
7. **Contracts/legal** → whole-document extraction across PDF pages.
8. **Ephemeral** — never write uploads or extraction results to disk.
9. **Schema library only** persists under `data/templates/`.
10. **Admin only** approves schemas.

---

## Template JSON schema

### Contract / legal (unpaired)

```json
{
  "templateKey": "contract/nda",
  "category": "contract",
  "version": 1,
  "paired": false,
  "fields": [
    {
      "name": "effectiveDate",
      "type": "date",
      "required": true,
      "description": "ISO 8601 date"
    }
  ]
}
```

### Identity (paired)

```json
{
  "templateKey": "identity/CO/national_id",
  "category": "identity",
  "version": 1,
  "paired": true,
  "sides": {
    "front": { "fields": [] },
    "back": { "fields": [] }
  }
}
```

### Field types → Zod mapping

| Template type | Zod |
|---------------|-----|
| `string` | `z.string()` |
| `date` | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` |
| `number` | `z.number()` |
| `boolean` | `z.boolean()` |
| `string[]` | `z.array(z.string())` |
| `text` | `z.string()` |

Build Zod schemas dynamically from template JSON. **Extraction** uses a relaxed schema (`buildRelaxedExtractionSchema`) with `z.unknown()` per field so the model is not sent typed JSON Schema metadata that resembles discovery proposals. Post-validation coerces values via `coerceExtractionData`. Strict schemas (`buildZodSchemaFromTemplate`) remain available for tests and tooling.

---

## API design

### `POST /api/extract`

**Request** (`multipart/form-data`):

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | One or more images, or one PDF |
| `templateKey` | No | e.g. `contract/nda`, `identity/CO/national_id` |

**Response 200:**

```json
{
  "flow": "extraction",
  "templateKey": "contract/nda",
  "schema": { },
  "data": { }
}
```

**Response 422:**

```json
{
  "error": "type_mismatch",
  "message": "Uploaded document does not match the specified template",
  "expectedTemplateKey": "contract/nda",
  "detectedTemplateKey": "identity/XX/passport"
}
```

### `POST /api/discover` (admin)

Starts a **Discovery Session**: runs Document Summary (step 1) and initial Schema Proposal (step 2). Returns `proposalId`, proposed schema, and `documentSummary`.

### `GET /api/discover/:id` (admin)

Returns the full session: proposal draft, `documentSummary`, `messages`, `revisionCount`.

### `PATCH /api/discover/:id` (admin)

Persists manual field-table edits to the session draft (template key, category, fields, sides).

### `POST /api/discover/:id/chat` (admin)

Streaming Schema Refinement chat via Vercel AI SDK (`streamText` + schema tools). The assistant is **consultative**: it asks clarifying questions and discusses options before calling schema tools. Tools mutate the draft only after clear admin instruction or explicit confirmation; messages persist on finish.

### `POST /api/discover/:id/revise` (admin)

**Document Re-review:** re-runs vision + `generateObject` against Cached Source Documents and current draft, then **regenerates `documentSummary`** from cached files plus draft context. Increments `revisionCount`.

### `POST /api/discover/:id/approve` (admin)

Body: edited schema JSON. Normalizes paired vs flat templates, validates schema shape and upload sides, then triggers extraction + optional save. Returns **422** for invalid schema, incomplete paired uploads, or extraction failures (not opaque 500). Deletes the session and cached files on success.

---

## Extraction pipelines

### Single-model (default)

```typescript
import { generateObject } from "ai";
import { buildZodSchemaFromTemplate } from "@/lib/schema";

export async function extractSingleStage(
  images: Buffer[],
  template: Template,
  model: string,
) {
  const schema = buildZodSchemaFromTemplate(template);

  const { object } = await generateObject({
    model,
    schema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract fields per schema. Preserve original language. Dates as YYYY-MM-DD.",
          },
          ...images.map((buf) => ({
            type: "image" as const,
            image: buf,
          })),
        ],
      },
    ],
  });

  return object;
}
```

### Two-stage (optional)

```typescript
import { generateText, generateObject } from "ai";

export async function extractTwoStage(
  images: Buffer[],
  template: Template,
  visionModel: string,
  structureModel: string,
) {
  const { text: visionOutput } = await generateText({
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract ALL visible text, labels, tables, and layout notes. Spanish and English.",
          },
          ...images.map((buf) => ({ type: "image" as const, image: buf })),
        ],
      },
    ],
  });

  const schema = buildZodSchemaFromTemplate(template);

  const { object } = await generateObject({
    model: structureModel,
    schema,
    prompt: `Map the following document content to the schema.\n\n${visionOutput}`,
  });

  return object;
}
```

Select pipeline via `EXTRACTION_PIPELINE` env var (`single`, `two-stage`, or `auto`). **Legal templates** and templates with more than `EXTRACTION_TWO_STAGE_FIELD_THRESHOLD` fields (default 15) always use two-stage extraction, even when `EXTRACTION_PIPELINE=single`. Extraction prompts list field names as plain text and include a system message that forbids schema-proposal output. If the model returns proposal metadata mixed with values, a repair pass strips metadata and keeps extracted field values.

---

## Eve agent layout

### `agent/instructions.md`

Define orchestrator behavior:

- Route to Discovery vs Extraction based on `templateKey` and library.
- Never persist uploads.
- Return JSON only.
- Delegate schema proposal to `schema_discovery` subagent.
- Delegate extraction to `document_extractor` subagent.

### `agent/subagents/schema_discovery.ts`

```typescript
import { defineAgent } from "eve";

export default defineAgent({
  description: "Analyzes document images and proposes extraction schema fields",
  model: process.env.DISCOVERY_MODEL ?? "openai/gpt-4o",
});
```

### `agent/tools/validate_match.ts`

- Input: `templateKey`, page images.
- Call classification model.
- Return `{ match: boolean, detectedTemplateKey: string }`.
- Mismatch → API returns 422.

### Human-in-the-loop

**PoC implementation:** Admin UI calls `POST /api/discover/:id/approve` with the edited schema JSON. No Eve continuation token is required — session state lives in `proposal-store`. The Eve `save_template` tool and approval gate remain in `agent/` for agents run via `eve dev`; production HTTP flow uses the approve route.

---

## PDF handling

```typescript
// lib/pdf.ts — pseudocode
export async function pdfToImages(buffer: Buffer, maxPages: number): Promise<Buffer[]> {
  // Use pdf-poppler, pdfjs-dist + canvas, or sharp-based renderer
  // Cap at MAX_PDF_PAGES
  // Return page images as buffers — never write to disk
}
```

For identity paired templates:

1. Render PDF pages.
2. AI proposes side per page.
3. Admin confirms sides (Discovery) or auto-confirm (Extraction after template known).
4. Validate all required sides present before extraction.

---

## Upload UI (`app/page.tsx`)

Use **shadcn/ui** components:

- `Input` type file (accept images + PDF)
- `Select` or `Combobox` for optional `templateKey`
- `Button` submit
- `Card` for JSON result (`<pre>` with syntax highlight)

Keep UI minimal for PoC.

---

## Admin UI (`app/admin/page.tsx`)

- List pending Discovery Sessions.
- **Unified conversation thread** (`DiscoveryChatPanel`): document summary, proposed schema (inline editable table, including paired front/back), chat messages, and system updates (e.g. re-read) in one scrollable flow.
- Consultative chat: assistant discusses before applying schema tool changes.
- Editable field table synced with chat tools (`PATCH` draft on edit).
- **Re-read document** triggers Document Re-review (`POST .../revise`) and refreshes the summary in-thread.
- Click **Schema looks good**, then **Approve & Extract** or **Save to Library**.
- Protect routes with `ADMIN_API_KEY` bearer token.

---

## Template store (`lib/template-store.ts`)

```typescript
import fs from "node:fs/promises";
import path from "node:path";

const TEMPLATE_DIR = process.env.TEMPLATE_STORE_PATH ?? "data/templates";

export async function getTemplate(templateKey: string) {
  const filePath = path.join(TEMPLATE_DIR, `${templateKey}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function saveTemplate(template: Template) {
  const filePath = path.join(TEMPLATE_DIR, `${template.templateKey}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(template, null, 2));
}

export async function listTemplates() {
  // Recursively list .json files excluding _example.template.json
}
```

---

## Language-agnostic extraction (optional upgrade)

1. Add `detectLanguage(text): string` in `lib/language.ts`.
2. Include `detectedLanguage` in API response.
3. Replace ES/EN-specific prompts with neutral instructions.
4. Add `localeHint?: string` to template JSON for format hints.
5. Run evals per language.

---

## Testing checklist

- [ ] Admin chat removes hallucinated fields and table stays in sync
- [ ] Re-read document updates draft from cached files
- [ ] Admin can edit required flags and save template
- [ ] Extraction with valid `templateKey` returns typed JSON
- [ ] Wrong `templateKey` returns 422 `type_mismatch`
- [ ] Paired identity missing back returns 422
- [ ] Blurry upload returns 422 `unreadable`
- [ ] No files written outside `data/templates/`
- [ ] Two-stage pipeline produces valid JSON
- [ ] Spanish and English sample docs extract correctly

---

## Deployment notes

- **Next.js 16** App Router; `experimental.serverActions.bodySizeLimit` in `next.config.ts`.
- Set env vars on Vercel (see MODELS_AND_REQUIREMENTS.md).
- Use AI Gateway OIDC on Vercel instead of raw API key when possible.
- Enable Fluid Compute.
- Do not enable Blob storage for uploads in PoC.

---

## Suggested implementation order

1. Template store + example JSON + Zod builder
2. PDF render + single-stage extraction tool
3. `POST /api/extract` without discovery
4. Upload UI with JSON viewer
5. Discovery subagent + admin UI
6. Template match validation + 422 errors
7. Eve session integration + human approval
8. Two-stage pipeline flag
9. Deploy + smoke test

---

## Questions?

Refer to the domain glossary in [CONTEXT.md](../CONTEXT.md) for canonical terminology.
