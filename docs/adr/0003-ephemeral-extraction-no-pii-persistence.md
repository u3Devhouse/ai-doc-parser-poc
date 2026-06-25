# Ephemeral extraction — no PII persistence

Identity documents, legal documents, and contracts contain sensitive data. The PoC must not retain Source Files or extracted field values on disk or in a database. Only the **Schema Library Store** (approved template definitions, no document content) persists under `data/templates/`. Extraction results are returned in the API response and discarded.

**Considered options:** Dev-only local persistence for debugging (rejected for default; may be added later behind an explicit env flag). Encrypted blob storage (out of scope for PoC).

**Consequences:** No upload history, no re-processing without re-upload. Retry Upload always starts fresh. Logging must exclude extracted PII and file contents.
