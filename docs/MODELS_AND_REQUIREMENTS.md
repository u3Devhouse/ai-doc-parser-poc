# Models and Requirements

This document defines whether [Vercel Eve](https://vercel.com/eve) fits this PoC, which AI models to use, infrastructure requirements, and environment configuration.

## Executive summary

| Question | Answer |
|----------|--------|
| Is Vercel Eve a good fit? | **Yes** — for this PoC's two-flow design (Discovery + Extraction), human schema validation, subagents, and deployability on Vercel. |
| Primary languages | **Spanish and English** (with notes for language-agnostic extraction) |
| Output format | **JSON** for both schema and extracted data |
| Data retention | **Ephemeral** — no upload or extraction persistence; schema library only |

---

## Why Vercel Eve fits

Eve matches the agreed architecture:

| Requirement | Eve capability |
|-------------|----------------|
| Discovery Flow with schema proposal | **Subagent** (`schema_discovery`) + tool returning proposed fields |
| Human schema validation (admin only) | **Human-in-the-loop** approval gate before saving template |
| Extraction Flow with library lookup | **Tool** (`extract_document`) + filesystem template store |
| Sender-specified `templateKey` | HTTP channel / API route parameter |
| Type mismatch rejection (422) | Validation tool before extraction |
| Multi-page PDF + images | Custom tool: PDF → page images, in-memory processing |
| Durable multi-step admin workflow | **Vercel Workflows** (sessions survive restarts) |
| Deploy to production | `vercel deploy` — same layout as local dev |

**When Eve is more than you need:** If you later only need a single `POST /extract` with no admin workflow, a plain **Next.js + Vercel AI SDK** app is enough. For this PoC, Eve is justified by Discovery Flow + admin approval + subagents.

Reference implementation pattern: [contract-review-agent](https://github.com/Nainish-Rai/contract-review-agent) (Eve + Next.js + file upload + streaming tools).

---

## Architecture overview

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  Upload UI  │────▶│  Eve HTTP API                             │
│  /admin     │     │  ┌────────────────┐  ┌─────────────────┐ │
└─────────────┘     │  │ schema_discovery│  │ extract_document │ │
                    │  │   (subagent)    │  │     (tool)       │ │
                    │  └────────┬─────────┘  └────────┬────────┘ │
                    │           │                      │          │
                    │     Human approval (admin)       │          │
                    │           ▼                      ▼          │
                    │     data/templates/*.json   AI Gateway      │
                    └──────────────────────────────────────────┘
```

### Two processing modes

#### Mode A — Single-model pipeline (default)

One multimodal model receives images/PDF pages + schema and returns structured JSON via `generateObject` + Zod.

**Best for:** Simpler PoC, fewer moving parts, good accuracy on clean scans.

#### Mode B — Two-model pipeline (optional)

| Step | Role | Model tier |
|------|------|------------|
| 1. Vision extraction | Read all visible text, tables, labels, layout hints | **Strong vision** model |
| 2. Structured mapping | Map vision output → schema fields with types | **Structured output** model |

**Best for:** Poor scans, dense legal PDFs, long contracts, or when field-level accuracy matters more than latency.

Enable with `EXTRACTION_PIPELINE=two-stage` (see Environment variables).

---

## Model recommendations

All models are accessed through **[Vercel AI Gateway](https://vercel.com/ai-gateway)**. Use gateway model IDs (`provider/model-name`).

### Default (balanced, Spanish + English)

| Role | Model ID | Why |
|------|----------|-----|
| **Primary extraction** | `openai/gpt-4o` | Strong multimodal + structured output; reliable on forms and contracts in ES/EN |
| **Classification / mismatch** | `openai/gpt-4o-mini` | Fast/cheap: document type detection, template match, type-mismatch check |
| **Discovery / schema proposal** | `openai/gpt-4o` | Needs layout understanding to propose fields |
| **Fallback extraction** | `google/gemini-2.5-flash` | Good vision + cost; useful A/B comparison |

Configure in `agent/agent.ts` and per-subagent overrides.

### Two-stage pipeline (optional)

| Stage | Model ID | Why |
|-------|----------|-----|
| **Vision pass** | `openai/gpt-4o` or `google/gemini-2.5-pro` | Maximum text recovery from images/PDF pages |
| **Structure pass** | `openai/gpt-4o-mini` or `openai/gpt-4o` | Cheaper model can suffice if vision pass returns clean text; use `gpt-4o` for complex legal schemas |
| **OCR-heavy scans** | `interfaze/interfaze-beta` | Specialized OCR/structured extraction (AI Gateway); test on scanned identity docs |

### Eve subagent mapping

| Component | Suggested model |
|-----------|-----------------|
| Main orchestrator | `openai/gpt-4o-mini` |
| `subagents/schema_discovery.ts` | `openai/gpt-4o` |
| `subagents/extract_document.ts` | `openai/gpt-4o` (or two-stage) |
| `tools/validate_template_match.ts` | `openai/gpt-4o-mini` |

---

## Language support

### v1: Spanish + English

- Prompts instruct the model to preserve original language in string fields.
- Dates normalized to **ISO 8601** (`YYYY-MM-DD`) regardless of source format.
- Admin UI and developer docs available in EN and ES.

### Making extraction language-agnostic (optional)

1. Add a `detectedLanguage` field to API responses (ISO 639-1, e.g. `es`, `en`).
2. Use a lightweight detection call (`gpt-4o-mini`) or library (`franc`) on vision-pass text.
3. Remove hard-coded Spanish/English examples from prompts; use neutral instructions: *"Extract text in the document's original language."*
4. Store optional `localeHint` on templates for formats (date order, ID number patterns).
5. For evals, maintain a **per-language golden set** — accuracy varies by script and layout.

---

## Functional requirements (consolidated)

### Flows

| Flow | Trigger | Result |
|------|---------|--------|
| **Discovery** | No `templateKey` and no library template | Propose schema → admin validates → extract → optionally save template |
| **Extraction (auto)** | No `templateKey`, template exists in library | Classify → extract → JSON response |
| **Extraction (specified)** | `templateKey` provided | Validate match → extract or **422 type_mismatch** |

### Upload rules

- **Single document per upload** — one identity doc, one contract, or one legal doc.
- **Formats:** JPEG, PNG, WebP, PDF.
- **PDF:** Pages rendered to images in memory; identity docs may require front + back in one upload.
- **Paired identity templates:** Parent key (e.g. `identity/CO/national_id`); missing or unreadable required sides → **reject entire upload**, ask for retry.
- **Contracts/legal:** Whole-document extraction across all pages.
- **No persistence** of uploads or extracted PII.

### Schema

- **Per document type** — each template has its own fields.
- **Field types:** `string`, `date`, `number`, `boolean`, `string[]`, `text`.
- **Required flags:** All fields optional in proposal; admin marks required during validation.
- **Signatures:** Metadata only (`signaturePresent: boolean`, `signatoryNames: string[]`).

### Template keys

| Category | Key pattern | Example |
|----------|---------------|---------|
| Identity (paired) | `identity/{country}/{type}` | `identity/CO/national_id` |
| Contract | `contract/{name}` | `contract/nda` |
| Legal | `legal/{name}` | `legal/power_of_attorney` |

Child side schemas for identity: `sides.front`, `sides.back` in template JSON (see `_example.template.json`).

### API errors

| Status | Code | When |
|--------|------|------|
| 422 | `type_mismatch` | `templateKey` does not match uploaded document |
| 422 | `unreadable` | Required content not readable |
| 422 | `incomplete` | Paired template missing required sides |
| 404 | `template_not_found` | `templateKey` not in library |

---

## Infrastructure requirements

### Accounts and services

| Service | Required | Purpose |
|---------|----------|---------|
| [Vercel](https://vercel.com) account | Yes | Hosting, Fluid Compute, Workflows |
| Vercel AI Gateway | Yes | Unified model access, observability |
| AI provider credits | Yes | OpenAI and/or Google via Gateway |
| Git | Yes | Version control |

### Local development

| Tool | Version |
|------|---------|
| Node.js | 20+ (24 recommended for Eve sandbox) |
| pnpm | 9.x or 10.x (project uses pnpm) |
| Vercel CLI | Latest (`npm i -g vercel`) |

### Vercel project settings

- **Fluid Compute:** enabled (default on new projects).
- **Environment variables:** set in Vercel dashboard and `.env.local`.
- **Blob/KV:** not required for PoC (ephemeral processing).

---

## Environment variables

```bash
# Required
AI_GATEWAY_API_KEY=           # Vercel AI Gateway key (or OIDC on Vercel)

# Models (override defaults)
EVE_MODEL=openai/gpt-4o-mini
DISCOVERY_MODEL=openai/gpt-4o
EXTRACTION_MODEL=openai/gpt-4o
VISION_MODEL=openai/gpt-4o
STRUCTURE_MODEL=openai/gpt-4o-mini
CLASSIFICATION_MODEL=openai/gpt-4o-mini

# Pipeline mode: single | two-stage
EXTRACTION_PIPELINE=single

# Template store path (relative to project root)
TEMPLATE_STORE_PATH=data/templates

# Admin auth (PoC — replace for production)
ADMIN_API_KEY=                # Protects /admin and schema approval endpoints

# Optional
MAX_PDF_PAGES=20
MAX_UPLOAD_MB=25
```

---

## Security and compliance (PoC)

- **Do not commit** real identity documents or contracts.
- **Do not persist** uploads or extraction results in production PoC.
- Schema library JSON contains **field definitions only**, not document content.
- Add `data/templates/*.json` to git but exclude any file with real customer data.
- Replace `ADMIN_API_KEY` with proper auth (WorkOS, Vercel Auth) before production.
- Log template keys and flow names only — **never log extracted PII**.

---

## Cost and performance notes

| Concern | Guidance |
|---------|----------|
| Large PDFs | Cap pages (`MAX_PDF_PAGES`); contracts > 20 pages may need chunking in a later iteration |
| Latency | Two-stage pipeline adds one model round-trip |
| Cost | Use `gpt-4o-mini` for classification; reserve `gpt-4o` for extraction |
| Evals | Eve built-in evals — define golden JSON per template when templates exist |

---

## Decision summary

| Topic | Decision |
|-------|----------|
| Framework | Vercel Eve + Next.js web channel |
| Models | AI Gateway; `gpt-4o` extraction, `gpt-4o-mini` classification |
| Optional | Two-stage vision + structure pipeline |
| Languages | Spanish + English (agnostic path documented) |
| Storage | `data/templates/` only; ephemeral extraction |
| UI | Upload UI + `/admin` discovery approval |
| Seeds | None; `_example.template.json` provided |

See also: [POC_GUIDE.md](./POC_GUIDE.md) / [POC_GUIDE.es.md](./POC_GUIDE.es.md), [DEVELOPER_GUIDE.en.md](./DEVELOPER_GUIDE.en.md) / [DEVELOPER_GUIDE.es.md](./DEVELOPER_GUIDE.es.md).
