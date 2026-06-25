# Category-specific template keys

Templates in the Schema Library are keyed by **Document Category**. Identity documents use parent keys `identity/{country}/{type}` with per-side child schemas (`sides.front`, `sides.back`) under **Paired Templates**. Contracts use `contract/{name}`; legal documents use `legal/{name}`. Each **Document-Type Schema** defines its own fields — schemas are not shared across unrelated types.

Senders may pass `templateKey` on upload to force Extraction Flow. Paired identity uploads require all required Document Sides in a **Single Document Upload**; missing or unreadable sides cause a **Rejected Upload** with no extracted data.

Contracts and legal documents use **Whole-Document Extraction** across all PDF Pages in one upload.

**Consequences:** Template store layout mirrors key paths. Identity and contract/legal paths diverge in validation and extraction orchestration.
