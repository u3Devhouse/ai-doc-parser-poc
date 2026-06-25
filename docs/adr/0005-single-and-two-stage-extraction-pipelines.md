# Single-model and optional two-stage extraction pipelines

Structured Extraction defaults to a **single-model pipeline**: one multimodal model receives page images and an Extraction Schema, returning typed JSON via schema-bound generation (Spanish and English optimized).

An optional **two-stage pipeline** separates **Vision Extraction** (strong vision model reads all visible text and layout) from **Structured Extraction** (structure model maps text to schema fields). Enabled via `EXTRACTION_PIPELINE=two-stage`. Documented path to language-agnostic extraction: detect language on vision output, neutral prompts, per-language eval sets.

**Considered options:** OCR-only pre-pass (e.g. Interfaze Beta) as default — deferred; available via AI Gateway for eval comparison.

**Consequences:** Extraction module must support both modes behind one interface. Two-stage adds latency and cost but improves accuracy on poor scans and dense legal PDFs.
