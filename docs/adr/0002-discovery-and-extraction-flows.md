# Discovery Flow and Extraction Flow as separate paths

Source documents may be unknown (no template in the Schema Library) or known (template exists or sender specifies a Template Key). We split processing into **Discovery Flow** (propose Schema Proposal → Human Validation by Schema Administrator → Structured Extraction → optional save to Schema Library) and **Extraction Flow** (Template Match → Structured Extraction → JSON response).

When a sender provides a **Specified Document Type** via `templateKey`, Discovery is skipped; the system validates the upload and returns HTTP 422 on **Type Mismatch**. When no template exists in the library and no `templateKey` is sent, the upload falls back to Discovery — not a confidence threshold.

**Consequences:** API and UI must expose both flows. Routing logic is a core seam for integration tests. Classification is used for mismatch detection and auto-routing, not as a confidence gate to Discovery when a library template exists.
