# PoC Step-by-Step Guide

This guide walks you through installing, configuring, and using the Document Extraction PoC.

## Prerequisites

- Node.js 20+
- pnpm
- Vercel account with [AI Gateway](https://vercel.com/ai-gateway) enabled
- AI Gateway API key

See [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md) for full requirements.

---

## Step 1 — Scaffold the project

```bash
npx eve@latest init document-extraction-poc --channel-web-nextjs
cd document-extraction-poc
pnpm install
```

> If you already have this repository, run `pnpm install` from the project root.

Copy environment template:

```bash
cp .env.example .env.local
```

Set at minimum:

```bash
AI_GATEWAY_API_KEY=your_key_here   # omit when using mock mode below
AI_GATEWAY_MOCK=true               # local dev without a Gateway key (deterministic mock JSON)
ADMIN_API_KEY=choose_a_strong_secret
```

For **local frontend testing without a Gateway key**, keep `AI_GATEWAY_MOCK=true` (default in `.env.example`). Set `AI_GATEWAY_MOCK=false` and provide `AI_GATEWAY_API_KEY` when you want real model responses.

---

## Step 2 — Start the dev server

```bash
pnpm dev
```

Open:

| URL | Purpose |
|-----|---------|
| `http://localhost:3000` | Upload UI |
| `http://localhost:3000/admin` | Schema administrator (Discovery Flow) |

---

## Step 3 — Understand the two flows

### Discovery Flow (unknown document type)

Use when **no template exists** in the library and the sender does **not** specify `templateKey`.

1. Upload a document (image or PDF).
2. System proposes a **schema** (fields + types).
3. **Admin** reviews at `/admin` — edits fields, marks required, approves.
4. System runs **extraction** against approved schema.
5. Admin may **save template** to `data/templates/` for future Extraction Flow use.
6. Response includes **JSON schema + extracted data**.

### Extraction Flow (known document type)

Use when a template **already exists** or sender provides `templateKey`.

1. Upload document (optionally set `templateKey`).
2. System validates document matches type (if `templateKey` set).
3. System extracts using library schema.
4. Response includes **JSON schema + extracted data**.

If no template matches and no `templateKey` was sent → falls back to **Discovery Flow**.

---

## Step 4 — Upload via web UI

1. Go to `http://localhost:3000`.
2. Choose files (image or PDF).
3. **Optional:** Select or type a `templateKey` (e.g. `contract/nda` or `identity/GT/dpi`).
   - Leave empty to auto-detect or enter Discovery Flow.
4. For identity documents with a paired template (e.g. Guatemala DPI), upload **front and back** in one submission (two images or one 2-page PDF).
5. Click **Extract**.
6. View JSON result in the response panel.

### Expected success response shape

```json
{
  "flow": "extraction",
  "templateKey": "contract/nda",
  "schema": {
    "templateKey": "contract/nda",
    "category": "contract",
    "version": 1,
    "fields": []
  },
  "data": {
    "disclosingParty": "Acme Corp",
    "effectiveDate": "2025-01-15",
    "signaturePresent": true
  }
}
```

---

## Step 5 — Upload via API

### Extraction with specified template

```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: multipart/form-data" \
  -F "templateKey=contract/nda" \
  -F "files=@./samples/nda.pdf"
```

### Extraction without template (auto or discovery)

```bash
curl -X POST http://localhost:3000/api/extract \
  -F "files=@./samples/unknown-doc.pdf"
```

### Discovery — start proposal

```bash
curl -X POST http://localhost:3000/api/discover \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -F "files=@./samples/new-contract.pdf"
```

---

## Step 6 — Admin: Discovery Session (conversational)

1. Open `http://localhost:3000/admin`.
2. Authenticate with admin credentials (`ADMIN_API_KEY`).
3. Upload a Source File and click **Start discovery session** (or open a pending session from the list).
4. Work in the **unified conversation thread**:
   - Read the **document summary** at the top (what the system saw: layout, sides, labels).
   - Review the **proposed schema** table inline (front/back for paired identity docs).
   - Chat to refine the schema — the assistant asks clarifying questions first and applies changes after you confirm (e.g. “yes, remove blood type”).
   - Click **Re-read document** to re-analyze the cached upload; the summary and schema update in the same thread.
5. Toggle **required** on fields that must be present.
6. Click **Schema looks good** when the draft is ready.
7. Click **Approve & Extract** — runs Structured Extraction against the cached Source File.
8. Or click **Save to library** — writes `data/templates/{templateKey}.json` and removes the session.

Chat, summary, and field table stay in sync. You do not need to re-upload between iterations.

---

## Step 7 — Create a template manually (without Discovery)

1. Copy the example file:

   ```bash
   cp data/templates/_example.template.json data/templates/contract/nda.json
   ```

2. Edit fields for your document type.
3. Restart dev server if templates are loaded at startup (or use hot-reload endpoint).
4. Test Extraction Flow with `templateKey=contract/nda`.

See `_example.template.json` for identity paired template structure.

---

## Step 8 — Handle errors and retries

| Error | Meaning | Action |
|-------|---------|--------|
| `type_mismatch` (422) | File does not match selected `templateKey` | Fix selection or upload correct file |
| `unreadable` (422) | Document too blurry or truncated | Retry with better scan |
| `incomplete` (422) | Paired identity doc missing front/back | Upload both sides in one submission |
| `template_not_found` (404) | `templateKey` not in library | Run Discovery Flow or create template |

**Retry policy:** Discard failed upload; submit a new file. No partial state is kept.

---

## Step 9 — Enable two-stage extraction (optional)

For difficult scans or long legal PDFs:

```bash
# .env.local
EXTRACTION_PIPELINE=two-stage
VISION_MODEL=openai/gpt-4o
STRUCTURE_MODEL=openai/gpt-4o-mini
```

Restart the dev server. Extraction will:

1. Run vision model → raw text + layout notes.
2. Run structure model → schema-bound JSON.

See [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md) for model details.

---

## Step 10 — Deploy to Vercel

```bash
vercel link
vercel env add AI_GATEWAY_API_KEY
vercel env add ADMIN_API_KEY
vercel deploy
```

Verify:

- Upload UI loads on production URL.
- `/admin` is protected.
- Extraction returns JSON; no files persisted on server.

---

## Quick reference — flow decision tree

```
Upload received
    │
    ├─ templateKey provided?
    │       ├─ YES → validate match → extract OR 422 type_mismatch
    │       └─ NO  → template in library?
    │                   ├─ YES → extract
    │                   └─ NO  → Discovery Flow
    │
    └─ readable & complete (paired rules)?
            ├─ YES → return JSON { schema, data }
            └─ NO  → 422 → ask user to retry upload
```

---

## Next steps for developers

- Implementation details: [DEVELOPER_GUIDE.en.md](./DEVELOPER_GUIDE.en.md) (English) / [DEVELOPER_GUIDE.es.md](./DEVELOPER_GUIDE.es.md) (Español)
- Models and infra: [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md)
- Domain glossary: [CONTEXT.md](../CONTEXT.md)

Spanish guide: [POC_GUIDE.es.md](./POC_GUIDE.es.md)
