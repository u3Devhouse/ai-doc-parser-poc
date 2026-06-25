# Document Extraction PoC

Proof of concept for uploading document images/PDFs, discovering or applying extraction schemas, and returning structured JSON via AI (Vercel Eve + AI Gateway).

## Documentation

| Document | Description |
|----------|-------------|
| [CONTEXT.md](./CONTEXT.md) | Domain glossary |
| [docs/PRD.md](./docs/PRD.md) | Product requirements |
| [docs/PRD_DISCOVERY_SESSION.md](./docs/PRD_DISCOVERY_SESSION.md) | Conversational Discovery Session PRD |
| [docs/DISCOVERY_SESSION_DESIGN.md](./docs/DISCOVERY_SESSION_DESIGN.md) | Discovery Session design |
| [docs/adr/](./docs/adr/) | Architecture decision records |
| [docs/MODELS_AND_REQUIREMENTS.md](./docs/MODELS_AND_REQUIREMENTS.md) | Eve fit, models, infrastructure |
| [docs/POC_GUIDE.md](./docs/POC_GUIDE.md) | Step-by-step usage guide |
| [docs/DEVELOPER_GUIDE.en.md](./docs/DEVELOPER_GUIDE.en.md) | Developer implementation (English) |
| [docs/DEVELOPER_GUIDE.es.md](./docs/DEVELOPER_GUIDE.es.md) | Guía de implementación (Español) |

## Implementation tracking

Local issues (not pushed to remote): [.local/issues/README.md](./.local/issues/README.md)

## Template authoring

Copy [data/templates/_example.template.json](./data/templates/_example.template.json) to create new templates.

**PoC templates included:**

| Template key | Document |
|--------------|----------|
| `identity/GT/dpi` | Guatemala DPI (paired front + back) |
| `contract/nda` | Non-disclosure agreement |

For Guatemala DPI, upload **both sides** in one submission and use `templateKey=identity/GT/dpi`.

## Quick start

```bash
npx eve@latest init document-extraction-poc --channel-web-nextjs
cp .env.example .env.local
# Local mock mode (no API key): AI_GATEWAY_MOCK=true (default in .env.example)
# Real AI: set AI_GATEWAY_API_KEY and AI_GATEWAY_MOCK=false
pnpm install
pnpm dev
```

See [docs/POC_GUIDE.md](./docs/POC_GUIDE.md) for full instructions.

## Security

Do not commit real identity documents or contracts. Uploads and extraction results are ephemeral (API response only).
