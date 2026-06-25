# Document Extraction

Proof of concept for uploading images or PDFs of documents, discovering extractable fields, and returning structured data via AI. Scope is open: identity documents, legal documents, and contracts are all in play.

## Language

**Source Document**:
Any document a user uploads for extraction, such as an identity document, a legal document, or a contract.
_Avoid_: File, upload, image

**Document Category**:
The broad class of a source document: identity, legal, or contract. Used to organize templates in the schema library.
_Avoid_: Document type, doc class, file kind

**Identity Document**:
A government-issued document that proves a person's identity, such as a national ID card, passport, or driver's license.
_Avoid_: ID file, credential image

**Legal Document**:
A formal document with legal effect that is not a contract, such as a power of attorney, affidavit, or court filing.
_Avoid_: Legal file, juridical document

**Contract**:
An agreement between parties that defines terms, obligations, and signatures.
_Avoid_: Agreement, legal contract, deal document

**Extraction Schema**:
The set of named fields and types the PoC attempts to read from a source document.
_Avoid_: JSON template, data model, prompt schema

**Schema Proposal**:
A draft extraction schema produced by analyzing an uploaded source document before structured extraction runs.
_Avoid_: Auto-schema, detected fields, guessed structure

**Field**:
A single named piece of information defined in an extraction schema (e.g. full name, effective date, party name).
_Avoid_: Property, key, attribute

**Discovery Flow**:
The path used when the document category or layout is initially unknown. The system proposes fields from the upload, a human validates and iterates on the extraction schema, structured extraction runs against the approved schema, and the result may be saved to the schema library.
_Avoid_: Onboarding flow, first-time upload, cold start

**Extraction Flow**:
The path used when the document can be identified from the upload. The system selects the matching schema from the library, extracts structured data, and rejects the upload if its content is not readable.
_Avoid_: Known-document flow, fast path, repeat upload

**Schema Library**:
The persisted collection of approved extraction schemas (templates) reused by the Extraction Flow.
_Avoid_: Template store, schema database, field registry

**Human Validation**:
A person reviews a schema proposal, edits which fields are required, and approves the schema before extraction proceeds in the Discovery Flow.
_Avoid_: Human-in-the-loop, manual review, admin approval

**Readable Content**:
Text and structure in a source document from which required fields can be extracted with sufficient confidence; otherwise the upload is rejected in the Extraction Flow.
_Avoid_: Valid upload, good quality, parseable file

**Document Side**:
Which face of an identity document is shown in an upload: front or back. Applies to identity documents keyed by country, document type, and side.
_Avoid_: Page, face, scan side

**Source File**:
The file a user uploads: a single image or a PDF that may contain one or more pages.
_Avoid_: Upload, asset, media file

**Page**:
One rendered surface from a PDF source file, treated as an image candidate for classification and extraction.
_Avoid_: Slide, sheet, frame

**Template Match**:
The result of identifying a source document against an approved schema in the library. When no template exists for the identified or specified document type, the upload falls back to the Discovery Flow.
_Avoid_: Classification hit, schema lookup, OCR match

**Specified Document Type**:
A template key or document type provided by the sender with the upload. Skips Discovery Flow; the system validates the upload against that type and extracts using the matching library schema.
_Avoid_: User-selected type, manual classification, forced template

**Type Mismatch**:
The upload does not match the sender-specified document type. The endpoint returns HTTP 422 with no extracted data; the user must retry with the correct type or file.
_Avoid_: Wrong document, classification error, invalid selection

**Template Key**:
The unique identifier for a template in the library and the value a sender may pass to skip Discovery Flow (e.g. `identity/CO/national_id`, `contract/nda`). Identity paired templates use a parent key; the upload must include all required sides.
_Avoid_: Schema ID, slug, lookup key

**Side Confirmation**:
The step where a human approves or corrects the AI-proposed document side (front or back) for each page before extraction proceeds. Applies primarily to identity documents.
_Avoid_: Side labeling, manual tagging, user annotation

**Paired Template**:
An extraction schema that requires more than one page or side (e.g. front and back of an ID) before structured data is considered complete.
_Avoid_: Two-sided schema, dual-side template, full document template

**Single Document Upload**:
Each upload represents one source document. A PDF may include multiple pages only for that document; additional unrelated pages are out of scope for the PoC.
_Avoid_: Batch upload, multi-document file, bulk import

**Rejected Upload**:
An upload where required content is missing for the identified document type, or where any required page or side is not readable. No extracted data is returned; the user is asked to retry the upload.
_Avoid_: Failed parse, bad image, low-quality scan

**Template**:
An approved extraction schema stored in the library, keyed by document category. Identity templates use a parent template key with per-side child schemas; contract and legal templates use a category-specific name.
_Avoid_: Schema entry, template record, extraction profile

**Whole-Document Extraction**:
Extraction that treats all pages of a contract or legal document as one unit, identifying the document first then extracting fields relevant to that document type.
_Avoid_: Full-document parse, multi-page extraction, document-level OCR

**Schema Administrator**:
A developer or admin who performs human validation on schema proposals in the Discovery Flow. End users do not approve schemas in the PoC.
_Avoid_: Admin user, reviewer, validator role

**Field Type**:
The data shape of a field in an extraction schema. Supported types in the PoC: string, date, number, boolean, string array, and text (long free-form).
_Avoid_: JSON type, Zod type, data type

**Document-Type Schema**:
An extraction schema scoped to one template and document type. Each document type defines its own fields; schemas are not shared across unrelated document types.
_Avoid_: Universal schema, global template, shared field set

**Schema Library Store**:
Approved templates persisted as JSON files (e.g. under `data/templates/`). The only long-lived data the PoC retains by default.
_Avoid_: Template database, schema cache, config store

**Ephemeral Extraction**:
Extracted data and source files are not persisted. Results are returned in the API response only; uploads are processed in memory and discarded.
_Avoid_: No storage, transient output, in-memory only

**Upload UI**:
A minimal web interface for submitting source files, optionally specifying a template key, and viewing extracted JSON results.
_Avoid_: Frontend, client app, user portal

**Admin Discovery UI**:
An in-app admin route where a schema administrator reviews schema proposals, edits fields, marks required fields, and approves templates into the library.
_Avoid_: Admin panel, back office, schema editor

**Template Example**:
A sample schema file showing the expected JSON shape for creating new templates. Shipped with the PoC; the library starts empty until templates are created via Discovery Flow or manual copy from the example.
_Avoid_: Seed data, demo template, mock schema

**Extraction Language**:
The human language of text in a source document. The PoC optimizes for Spanish and English; language-agnostic extraction is documented as an optional configuration path.
_Avoid_: Locale, i18n, document locale

**Vision Extraction**:
The step where a strong vision model reads document images or PDF pages and returns raw or semi-structured text and field candidates before schema-bound extraction.
_Avoid_: OCR pass, image parse, first pass

**Structured Extraction**:
The step where a model maps vision output into a validated JSON object matching an approved extraction schema.
_Avoid_: Second pass, schema fill, JSON mapping

**Discovery Session**:
A stateful admin workflow for one unknown Source Document: cached Source Files, an initial Schema Proposal, a Document Summary, conversation history, and a draft schema until Human Validation completes or the session is discarded.
_Avoid_: Discovery job, onboarding session, proposal workflow

**Document Summary**:
A short human-readable description of what the system saw in a Source Document during discovery (layout, language, sides, notable labels). Shown to the Schema Administrator before field refinement; not part of the saved Template.
_Avoid_: OCR dump, vision transcript, document abstract

**Schema Refinement**:
The conversational step where a Schema Administrator and the AI adjust the draft extraction schema—adding, removing, or correcting fields based on what should or should not exist on the document.
_Avoid_: Schema editing, field tuning, chat discovery

**Document Re-review**:
Re-running vision and structured proposal generation against the cached Source Files in a Discovery Session, using the current draft schema and refinement context. Triggered explicitly by the admin or after major structural changes.
_Avoid_: Re-upload, re-discover, second pass OCR

**Cached Source Document**:
The Source File bytes held only for the lifetime of a Discovery Session in the proposal store. Discarded when the session is approved or removed; not part of the Schema Library.
_Avoid_: Staged upload, temp file, session attachment
