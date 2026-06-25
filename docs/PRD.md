# PRD: Document Extraction PoC

**Status:** Ready for implementation  
**Triage label:** `ready-for-agent`  
**Domain glossary:** [CONTEXT.md](../CONTEXT.md)  
**ADRs:** [docs/adr/](./adr/)

---

## Problem Statement

Teams need to extract structured data from photographed or scanned documents — identity documents, legal documents, and contracts — without building bespoke OCR pipelines per document layout. Document types vary widely; required fields differ per Document Category and per Document-Type Schema. When a layout is new, someone must discover which fields exist, define an Extraction Schema, and reuse it for future uploads. When a layout is known, extraction must be fast, typed, and strict about wrong document types or unreadable uploads. Sensitive content must not be persisted during a proof of concept.

## Solution

A Vercel Eve–based PoC with two flows:

1. **Discovery Flow** — for unknown layouts: analyze a Source Document, produce a Schema Proposal, let a Schema Administrator validate and iterate via Human Validation, run Structured Extraction, optionally save an approved Template to the Schema Library.
2. **Extraction Flow** — for known layouts: match or accept a Specified Document Type (`templateKey`), validate Template Match, extract against the library schema, return JSON `{ schema, data }`. Reject the upload on Type Mismatch, missing paired sides, or unreadable content.

Delivery includes a minimal Upload UI, an Admin Discovery UI, REST API, AI Gateway–backed models (Spanish + English), optional two-stage Vision Extraction + Structured Extraction, and Ephemeral Extraction (no PII on disk).

---

## User Stories

### Upload and formats

1. As an integrator, I want to upload JPEG, PNG, WebP, or PDF Source Files, so that I can process phone photos and multi-page scans.
2. As an integrator, I want each upload to represent a Single Document Upload, so that the PoC scope stays bounded and predictable.
3. As an integrator, I want PDFs rendered to in-memory Pages without persisting files, so that privacy requirements are met.
4. As an integrator, I want a maximum page count and file size enforced, so that runaway PDFs do not exhaust compute.

### Extraction Flow

5. As an integrator, I want to optionally send a `templateKey` with my upload, so that I skip Discovery Flow when I know the document type.
6. As an integrator, I want HTTP 422 `type_mismatch` when my `templateKey` does not match the uploaded Source Document, so that I do not get silently wrong data.
7. As an integrator, I want extraction to use an existing Template from the Schema Library when no `templateKey` is sent but a template exists, so that repeat document types are handled automatically.
8. As an integrator, I want to receive JSON containing both the Extraction Schema used and the extracted `data`, so that I can validate and forward results downstream.
9. As an integrator, I want unreadable uploads rejected with no extracted data, so that I know to submit a Retry Upload.
10. As an integrator, I want missing required Document Sides for Paired Templates to reject the entire upload, so that incomplete identity captures are not treated as success.

### Discovery Flow

11. As a Schema Administrator, I want the system to propose fields and types from an unknown upload, so that I do not manually author schemas from scratch.
12. As a Schema Administrator, I want to edit proposed field names, types, and descriptions before extraction, so that the schema matches business requirements.
13. As a Schema Administrator, I want to mark fields as required during Human Validation, so that future extractions enforce completeness.
14. As a Schema Administrator, I want to approve a schema and run Structured Extraction in one step, so that I verify the schema against real content.
15. As a Schema Administrator, I want to save an approved Template to the Schema Library Store, so that Extraction Flow can reuse it.
16. As a Schema Administrator, I want Discovery protected by admin authentication, so that end users cannot alter the library.

### Identity documents

17. As an integrator, I want to upload front and back of an Identity Document in one submission, so that Paired Template rules are satisfied.
18. As a Schema Administrator, I want the AI to propose Document Side per page with Side Confirmation before extraction, so that front/back fields map correctly.
19. As an integrator, I want parent Template Keys like `identity/CO/national_id`, so that I do not manage separate keys per side at upload time.
20. As an integrator, I want per-side field definitions under `sides.front` and `sides.back`, so that each face can have different fields.

### Contracts and legal documents

21. As an integrator, I want Whole-Document Extraction across all PDF Pages for contracts, so that clauses spanning pages are captured.
22. As an integrator, I want Whole-Document Extraction for legal documents, so that powers of attorney and similar forms are handled as one unit.
23. As a Schema Administrator, I want contract and legal templates keyed as `contract/{name}` and `legal/{name}`, so that categories stay distinct in the library.

### Schema and field model

24. As a Schema Administrator, I want each Document-Type Schema to define its own fields, so that an NDA and a national ID do not share irrelevant columns.
25. As a Schema Administrator, I want field types `string`, `date`, `number`, `boolean`, `string[]`, and `text`, so that common document fields are representable.
26. As a Schema Administrator, I want all fields optional in the initial Schema Proposal, so that I choose required fields during validation.
27. As an integrator, I want signature metadata (`signaturePresent`, `signatoryNames`) without image crops, so that compliance-friendly hints exist without storing biometric data.

### Routing and fallbacks

28. As an integrator, I want uploads to fall back to Discovery Flow when no library template exists and no `templateKey` was sent, so that new layouts are onboarded without code changes.
29. As an integrator, I want no confidence-threshold gate when a library template exists, so that matching is library-driven not probabilistic.
30. As an integrator, I want a Retry Upload to discard the previous attempt entirely, so that no partial state leaks between tries.

### Language and models

31. As an integrator, I want extraction optimized for Spanish and English documents, so that LATAM identity and contract content is handled well.
32. As a developer, I want documentation on making extraction language-agnostic, so that we can expand locales later without re-architecting.
33. As a developer, I want a default single-model extraction pipeline, so that the PoC is simple to run.
34. As a developer, I want an optional two-stage Vision Extraction + Structured Extraction pipeline, so that poor scans and dense legal PDFs can be improved.

### UI

35. As an end user, I want a minimal Upload UI to submit files and optionally select a `templateKey`, so that I can demo extraction without curl.
36. As an end user, I want to see formatted JSON results in the Upload UI, so that I can inspect schema and data immediately.
37. As a Schema Administrator, I want an Admin Discovery UI at `/admin`, so that I can complete Human Validation without raw API calls.

### Security and operations

38. As a developer, I want uploads and extracted data to remain ephemeral, so that the PoC avoids PII retention obligations.
39. As a developer, I want only template definitions persisted in the Schema Library Store, so that the library contains no customer document content.
40. As a developer, I want a Template Example file without seed templates, so that I can author new templates from a documented shape.
41. As a developer, I want to deploy on Vercel with AI Gateway, so that the PoC matches production infrastructure.
42. As a developer, I want developer guides in English and Spanish, so that the team can implement consistently.

### Eve agent behavior

43. As a developer, I want a schema discovery subagent, so that schema proposal is isolated from extraction orchestration.
44. As a developer, I want a document extractor subagent or tool, so that Structured Extraction is reusable across flows.
45. As a developer, I want human-in-the-loop before saving templates, so that Eve sessions pause for admin approval.

---

## Implementation Decisions

### Platform and agents

- Use **Vercel Eve** with Next.js web channel (see ADR-0001).
- Orchestrator routes between Discovery Flow and Extraction Flow per ADR-0002.
- Subagents: `schema_discovery` (Schema Proposal), `document_extractor` (Structured Extraction).
- Tools: load/save template, validate template match, render PDF to pages, extract structured JSON.
- Models via **Vercel AI Gateway**: `openai/gpt-4o` (discovery/extraction), `openai/gpt-4o-mini` (classification/mismatch). Optional two-stage per ADR-0005.

### Schema library

- Filesystem **Schema Library Store** at `data/templates/`.
- No seed templates; ship **Template Example** only (`_example.template.json`).
- Template JSON shape (from prototype):

```json
{
  "templateKey": "contract/nda",
  "category": "contract",
  "version": 1,
  "paired": false,
  "fields": [
    { "name": "effectiveDate", "type": "date", "required": false, "description": "ISO 8601" }
  ]
}
```

Paired identity parent template uses `paired: true` and `sides: { "front": { "fields": [] }, "back": { "fields": [] } }`.

### API contracts

- `POST /api/extract` — multipart `files`, optional `templateKey`. Returns 200 `{ flow, templateKey, schema, data }`.
- Errors: 422 `type_mismatch`, `unreadable`, `incomplete`; 404 `template_not_found`.
- `POST /api/discover` — admin auth; starts Discovery Flow; returns proposal.
- `POST /api/discover/:id/approve` — admin auth; body = edited schema; extracts and optionally saves.

### Extraction behavior

- **Ephemeral Extraction** — no disk writes for uploads or results (ADR-0003).
- **Single-model default**; **two-stage** via `EXTRACTION_PIPELINE=two-stage`.
- Dates normalized to ISO 8601; string fields preserve source language (ES/EN).
- Signature fields: metadata only (`signaturePresent`, `signatoryNames`).

### Template keys (ADR-0004)

| Category | Key pattern |
|----------|-------------|
| Identity (paired) | `identity/{country}/{type}` |
| Contract | `contract/{name}` |
| Legal | `legal/{name}` |

### UI

- Upload UI: file input, optional `templateKey` selector, JSON result panel (shadcn/ui).
- Admin Discovery UI: editable field table, approve & extract, save to library.
- Admin routes protected by `ADMIN_API_KEY` (PoC only).

### Environment

- Required: `AI_GATEWAY_API_KEY`, `ADMIN_API_KEY`.
- Optional: `EXTRACTION_PIPELINE`, per-role model overrides, `MAX_PDF_PAGES`, `MAX_UPLOAD_MB`.

---

## Testing Decisions

### What makes a good test

Test **external behavior** at the highest practical seam — HTTP API contracts and JSON response shapes — not internal AI prompts or private Zod builder helpers. Mock the AI Gateway / `generateObject` responses so tests are deterministic. Do not assert on model provider call counts unless testing routing flags (e.g. two-stage vs single).

### Testing seams (highest first)

1. **API integration tests** (`POST /api/extract`, `POST /api/discover`, approve endpoint) — primary seam. Covers routing, status codes, ephemeral guarantee (no files written), and response JSON shape.
2. **Template store integration** — read/write/list templates via public lib API used by routes; verify category-specific keys and paired schema parsing.
3. **PDF page rendering** — verify page count limits and in-memory buffers only (no filesystem side effects).
4. **E2E smoke** (optional, manual or CI with secrets) — one real Gateway call against synthetic sample; not required for every PR.

Prefer reusing API-level tests over new unit-test seams. If Zod schema building is tested, do so only through extraction API responses with a mocked model returning edge-case payloads.

### Modules under test

| Seam | Behaviors verified |
|------|-------------------|
| Extract API | 200 success shape; 422 mismatch/unreadable/incomplete; 404 missing template; no persistence |
| Discover API | Proposal shape; admin auth; approve saves template |
| Flow routing | `templateKey` specified → no discovery; no template → discovery; library hit → extraction |
| Paired identity | Missing back → 422; unreadable side → 422 reject entire upload |

### Prior art

Greenfield PoC — no existing tests. Follow patterns from Eve contract-review-agent: API route tests with mocked AI SDK, Vitest or Jest with Next.js test utilities.

---

## Out of Scope

- Multi-document PDF splitting (unrelated pages in one file).
- Persisting uploads, extracted PII, or audit logs with document content.
- End-user Human Validation (admin only).
- Seed templates in the repository (example file only).
- Image crops for signatures or photos.
- Production auth (WorkOS, OAuth) — `ADMIN_API_KEY` only.
- Rich field types (`money`, `address`, nested `party` objects).
- Batch / async job queue for large backlogs.
- Compliance certifications (GDPR tooling, encryption at rest for extractions).
- Non-Vercel deployment targets.

---

## Further Notes

- Local implementation issues: [.local/issues/README.md](../.local/issues/README.md) (not pushed to remote).
- Models and env vars: [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md).
- Usage guide: [POC_GUIDE.md](./POC_GUIDE.md).
- Implementation guides: [DEVELOPER_GUIDE.en.md](./DEVELOPER_GUIDE.en.md), [DEVELOPER_GUIDE.es.md](./DEVELOPER_GUIDE.es.md).

### Testing seams — confirm with team

Proposed highest seams for verification:

1. **HTTP API** — extract and discover routes (mocked AI).
2. **Template store** — only via routes that load/save templates.
3. **No direct unit tests on Eve instruction markdown or subagent files** unless a pure function is extracted.

If you expect CI to run without `AI_GATEWAY_API_KEY`, all AI calls must be mockable at the AI SDK boundary in API tests.
