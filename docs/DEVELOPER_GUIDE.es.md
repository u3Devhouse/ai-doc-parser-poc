# Guía de Implementación para Desarrolladores (Español)

Esta guía explica cómo implementar el PoC de Extracción de Documentos para desarrolladores que se incorporen al proyecto.

## Documentos relacionados

| Documento | Propósito |
|-----------|-----------|
| [CONTEXT.md](../CONTEXT.md) | Glosario de dominio |
| [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md) | Modelos, variables de entorno, infraestructura |
| [POC_GUIDE.md](./POC_GUIDE.md) / [POC_GUIDE.es.md](./POC_GUIDE.es.md) | Guía de uso paso a paso (EN / ES) |
| [PRD_DISCOVERY_SESSION.md](./PRD_DISCOVERY_SESSION.md) | PRD de Discovery Session conversacional |
| [DISCOVERY_SESSION_DESIGN.md](./DISCOVERY_SESSION_DESIGN.md) | Diseño de Discovery Session |

---

## Inicio rápido

```bash
# Si clonas este repositorio (omitir init):
pnpm install
cp .env.example .env.local
pnpm dev
```

Para un **scaffold nuevo** (ver [POC_GUIDE.es.md](./POC_GUIDE.es.md)):

```bash
npx eve@latest init document-extraction-poc --channel-web-nextjs
cd document-extraction-poc
pnpm install
cp .env.example .env.local
pnpm dev
```

| URL | Propósito |
|-----|-----------|
| `http://localhost:3000` | UI de carga |
| `http://localhost:3000/admin` | Admin Discovery Session (requiere `ADMIN_API_KEY`) |

**Desarrollo local sin clave Gateway:** mantener `AI_GATEWAY_MOCK=true` en `.env.local` (valor por defecto en `.env.example`). Para modelos reales: `AI_GATEWAY_MOCK=false` y `AI_GATEWAY_API_KEY`.

```bash
pnpm test        # pruebas de integración/unidad (modo mock)
pnpm typecheck
pnpm build
```

**Plantillas incluidas:** `identity/GT/dpi` (DPI Guatemala emparejado), `contract/nda`. Copiar [data/templates/_example.template.json](../data/templates/_example.template.json) para nuevos tipos.

---

## Estructura del proyecto

```
document-extraction-poc/
├── app/                             # Next.js 16 App Router
│   ├── page.tsx                     # UI de carga
│   ├── admin/page.tsx               # UI admin (chat + resumen)
│   ├── layout.tsx
│   └── api/
│       ├── extract/route.ts         # POST extracción / redirección a descubrimiento
│       └── discover/
│           ├── route.ts             # POST discover, GET listado
│           └── [id]/
│               ├── route.ts         # GET sesión, PATCH borrador
│               ├── chat/route.ts    # Refinamiento conversacional en streaming
│               ├── revise/route.ts  # Re-revisión del documento
│               └── approve/route.ts
├── agent/                           # Scaffold Eve (instrucciones, subagentes, herramientas)
│   ├── agent.ts
│   ├── instructions.md
│   ├── channels/eve.ts              # Canal HTTP Eve + auth OIDC
│   ├── subagents/                   # schema_discovery, document_extractor
│   └── tools/                       # validate_match, extract_structured, save_template, …
├── components/
│   ├── admin/discovery-chat-panel.tsx
│   └── ui/                          # Primitivos shadcn/ui
├── lib/
│   ├── template-store.ts            # Biblioteca de esquemas (`data/templates/`)
│   ├── proposal-store.ts            # Sesiones Discovery (`data/proposals/`)
│   ├── schema.ts                    # Constructores Zod (estricto + relajado)
│   ├── extraction.ts                # Llamadas AI Gateway (clasificar, extraer, proponer)
│   ├── extract-handler.ts           # Orquestación POST /api/extract
│   ├── discover-handler.ts          # Handlers HTTP + chat de descubrimiento
│   ├── discovery-schema-tools.ts    # Herramientas de mutación de esquema
│   ├── extraction-prompt.ts
│   ├── pdf.ts                       # PDF → imágenes en memoria
│   ├── upload.ts                    # Parseo multipart + validación
│   ├── auth.ts                      # Verificación bearer ADMIN_API_KEY
│   ├── ai-mock.ts                   # Mock determinista con AI_GATEWAY_MOCK=true
│   ├── resolve-ai-overrides.ts
│   ├── ai-route-errors.ts
│   ├── api-client.ts
│   └── types.ts
├── data/
│   ├── templates/                   # Solo biblioteca de esquemas persiste
│   └── proposals/                   # Sesiones efímeras (se borran al aprobar)
├── tests/                           # vitest
├── docs/
├── .env.example
├── next.config.ts
├── vercel.json
└── package.json                     # pnpm; Node 24.x
```

### Arquitectura en tiempo de ejecución (importante)

Las rutas HTTP llaman a **handlers `lib/*` + Vercel AI SDK** (`generateObject`, `streamText`, `gateway()` de `@ai-sdk/gateway`) directamente — no al runtime del agente Eve. El árbol `agent/` es el **scaffold Eve** e documenta la orquestación prevista; el chat de descubrimiento y la extracción están en rutas API de Next.js según [ADR 0006](./adr/0006-conversational-discovery-with-ai-sdk.md).

---

## Variables de entorno

Ver `.env.example`. Mínimo para desarrollo local:

| Variable | Propósito |
|----------|---------|
| `AI_GATEWAY_MOCK` | `true` = sin API key; JSON mock determinista |
| `AI_GATEWAY_API_KEY` | Clave Vercel AI Gateway (u OIDC en Vercel) |
| `ADMIN_API_KEY` | Token bearer para `/admin` y `/api/discover/*` |
| `EXTRACTION_PIPELINE` | `auto` (defecto), `single`, o `two-stage` |
| `EXTRACTION_TWO_STAGE_FIELD_THRESHOLD` | Fuerza dos etapas si supera el umbral de campos (defecto 15) |
| `TEMPLATE_STORE_PATH` | Raíz de biblioteca (defecto `data/templates`) |
| `PROPOSAL_STORE_PATH` | Caché de sesiones (defecto `data/proposals`) |

Modelos: `DISCOVERY_MODEL`, `EXTRACTION_MODEL`, `VISION_MODEL`, `STRUCTURE_MODEL`, `CLASSIFICATION_MODEL`. Lista completa: [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md).

---

## Reglas de dominio (contrato de implementación)

Implementar exactamente como se define en `CONTEXT.md`:

1. **Flujo de Descubrimiento** cuando no hay plantilla en la biblioteca ni `templateKey`.
2. **Flujo de Extracción** cuando existe plantilla o se envía `templateKey`.
3. **`templateKey` especificado** → omitir descubrimiento; devolver **422** si no coincide.
4. **Sin plantilla en biblioteca** (sin `templateKey`) → descubrimiento (no depender de umbral de confianza).
5. **Una carga por documento**; reintentos descartan el intento anterior.
6. **Identidad emparejada** (frente/reverso): todas las caras requeridas legibles o rechazar toda la carga.
7. **Contratos/legal** → extracción del documento completo en todas las páginas del PDF.
8. **Efímero** — nunca escribir cargas ni resultados en disco.
9. **Solo la biblioteca de esquemas** persiste en `data/templates/`.
10. **Solo el administrador** aprueba esquemas.

---

## Esquema JSON de plantilla

### Contrato / legal (no emparejado)

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
      "description": "Fecha ISO 8601"
    }
  ]
}
```

### Identidad (emparejado)

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

### Tipos de campo → mapeo Zod

| Tipo en plantilla | Zod |
|-------------------|-----|
| `string` | `z.string()` |
| `date` | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` |
| `number` | `z.number()` |
| `boolean` | `z.boolean()` |
| `string[]` | `z.array(z.string())` |
| `text` | `z.string()` |

Construir esquemas Zod dinámicamente desde el JSON de plantilla. **Extracción** usa un esquema relajado (`buildRelaxedExtractionSchema`) con `z.unknown()` por campo para no enviar al modelo metadatos JSON Schema que parezcan propuestas de descubrimiento. La post-validación coacciona valores con `coerceExtractionData`. Los esquemas estrictos (`buildZodSchemaFromTemplate`) siguen disponibles para pruebas y herramientas.

---

## Diseño de API

### `POST /api/extract`

**Solicitud** (`multipart/form-data`):

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `files` | Sí | Una o más imágenes, o un PDF |
| `templateKey` | No | ej. `contract/nda`, `identity/CO/national_id` |

**Respuesta 200:**

```json
{
  "flow": "extraction",
  "templateKey": "contract/nda",
  "schema": { },
  "data": { }
}
```

**Respuesta 422:**

```json
{
  "error": "type_mismatch",
  "message": "El documento cargado no coincide con la plantilla especificada",
  "expectedTemplateKey": "contract/nda",
  "detectedTemplateKey": "identity/XX/passport"
}
```

### `POST /api/discover` (admin)

Inicia una **Discovery Session**: ejecuta Document Summary (paso 1) y Schema Proposal inicial (paso 2). Devuelve `proposalId`, esquema propuesto y `documentSummary`.

### `GET /api/discover/:id` (admin)

Devuelve la sesión completa: borrador, `documentSummary`, `messages`, `revisionCount`.

### `PATCH /api/discover/:id` (admin)

Persiste ediciones manuales de la tabla de campos en el borrador de la sesión.

### `POST /api/discover/:id/chat` (admin)

Chat de Schema Refinement en streaming (AI SDK `streamText` + herramientas de esquema). El asistente es **consultivo**: hace preguntas y discute opciones antes de usar herramientas. Las herramientas mutan el borrador solo tras instrucción clara o confirmación explícita; los mensajes se guardan al finalizar.

### `POST /api/discover/:id/revise` (admin)

**Document Re-review:** vuelve a ejecutar visión + `generateObject` contra Cached Source Documents y el borrador actual, luego **regenera `documentSummary`** desde archivos en caché y contexto del borrador. Incrementa `revisionCount`.

### `POST /api/discover/:id/approve` (admin)

Cuerpo: esquema editado. Normaliza plantillas paired vs planas, valida forma del esquema y lados del upload, luego ejecuta extracción y guardado opcional. Devuelve **422** para esquema inválido, uploads paired incompletos o fallos de extracción (no 500 opaco). Elimina la sesión y archivos en caché al completar.

---

## Pipelines de extracción

### Un solo modelo (por defecto)

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
            text: "Extrae los campos según el esquema. Preserva el idioma original. Fechas en YYYY-MM-DD.",
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

### Dos etapas (opcional)

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
            text: "Extrae TODO el texto visible, etiquetas, tablas y notas de diseño. Español e inglés.",
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
    prompt: `Mapea el siguiente contenido al esquema.\n\n${visionOutput}`,
  });

  return object;
}
```

Seleccionar pipeline mediante `EXTRACTION_PIPELINE` (`single`, `two-stage`, o `auto`). Las plantillas **legal** y las que superan `EXTRACTION_TWO_STAGE_FIELD_THRESHOLD` campos (defecto 15) usan siempre extracción en dos etapas, incluso con `EXTRACTION_PIPELINE=single`. Los prompts de extracción listan nombres de campo como texto plano e incluyen un mensaje de sistema que prohíbe salida de propuesta de esquema. Si el modelo mezcla metadatos con valores, un paso de reparación elimina metadatos y conserva los valores extraídos.

---

## Configuración del agente Eve

### `agent/instructions.md`

Definir comportamiento del orquestador:

- Enrutar a Descubrimiento vs Extracción según `templateKey` y biblioteca.
- Nunca persistir cargas.
- Devolver solo JSON.
- Delegar propuesta de esquema al subagente `schema_discovery`.
- Delegar extracción al subagente `document_extractor`.

### `agent/subagents/schema_discovery.ts`

```typescript
import { defineAgent } from "eve";

export default defineAgent({
  description: "Analiza imágenes de documentos y propone campos del esquema de extracción",
  model: process.env.DISCOVERY_MODEL ?? "openai/gpt-4o",
});
```

### `agent/tools/validate_match.ts`

- Entrada: `templateKey`, imágenes de páginas.
- Llamar modelo de clasificación.
- Devolver `{ match: boolean, detectedTemplateKey: string }`.
- Sin coincidencia → API devuelve 422.

### Human-in-the-loop

**Implementación PoC:** La UI admin llama a `POST /api/discover/:id/approve` con el JSON del esquema editado. No se requiere token de continuación Eve — el estado vive en `proposal-store`. La herramienta Eve `save_template` y la puerta de aprobación siguen en `agent/` para `eve dev`; el flujo HTTP de producción usa la ruta approve.

---

## Manejo de PDF

```typescript
// lib/pdf.ts — pseudocódigo
export async function pdfToImages(buffer: Buffer, maxPages: number): Promise<Buffer[]> {
  // Usar pdf-poppler, pdfjs-dist + canvas, o renderizador con sharp
  // Limitar a MAX_PDF_PAGES
  // Devolver imágenes como buffers — nunca escribir en disco
}
```

Para plantillas de identidad emparejadas:

1. Renderizar páginas del PDF.
2. IA propone el lado (frente/reverso) por página.
3. Admin confirma lados (Descubrimiento) o auto-confirma (Extracción con plantilla conocida).
4. Validar que todos los lados requeridos estén presentes antes de extraer.

---

## UI de carga (`app/page.tsx`)

Usar componentes de **shadcn/ui**:

- `Input` tipo archivo (aceptar imágenes + PDF)
- `Select` o `Combobox` para `templateKey` opcional
- `Button` enviar
- `Card` para resultado JSON (`<pre>` con resaltado de sintaxis)

Mantener la UI mínima para el PoC.

---

## UI de administración (`app/admin/page.tsx`)

- Listar Discovery Sessions pendientes.
- **Hilo de conversación unificado** (`DiscoveryChatPanel`): resumen del documento, esquema propuesto (tabla editable en línea, incl. front/back paired), mensajes de chat y actualizaciones del sistema (p. ej. re-read) en un solo scroll.
- Chat consultivo: el asistente discute antes de aplicar cambios con herramientas de esquema.
- Tabla de campos editable sincronizada con el chat (`PATCH` al editar).
- **Re-read document** dispara Document Re-review (`POST .../revise`) y actualiza el resumen en el hilo.
- Clic en **Schema looks good**, luego **Aprobar y Extraer** o **Guardar en Biblioteca**.
- Proteger rutas con token bearer `ADMIN_API_KEY`.

---

## Almacén de plantillas (`lib/template-store.ts`)

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
  // Listar recursivamente archivos .json excluyendo _example.template.json
}
```

---

## Extracción independiente del idioma (mejora opcional)

1. Agregar `detectLanguage(text): string` en `lib/language.ts`.
2. Incluir `detectedLanguage` en la respuesta de la API.
3. Reemplazar prompts específicos ES/EN por instrucciones neutrales.
4. Agregar `localeHint?: string` al JSON de plantilla para formatos regionales.
5. Ejecutar evaluaciones por idioma.

---

## Lista de verificación de pruebas

- [ ] El chat admin elimina campos alucinados y la tabla permanece sincronizada
- [ ] Re-read document actualiza el borrador desde archivos en caché
- [ ] Admin puede editar campos requeridos y guardar plantilla
- [ ] Extracción con `templateKey` válido devuelve JSON tipado
- [ ] `templateKey` incorrecto devuelve 422 `type_mismatch`
- [ ] Identidad emparejada sin reverso devuelve 422
- [ ] Carga borrosa devuelve 422 `unreadable`
- [ ] No se escriben archivos fuera de `data/templates/`
- [ ] Pipeline de dos etapas produce JSON válido
- [ ] Documentos de muestra en español e inglés extraen correctamente

---

## Notas de despliegue

- **Next.js 16** App Router; `experimental.serverActions.bodySizeLimit` en `next.config.ts`.
- Configurar variables de entorno en Vercel (ver MODELS_AND_REQUIREMENTS.md).
- Usar OIDC de AI Gateway en Vercel cuando sea posible.
- Habilitar Fluid Compute.
- No habilitar Blob storage para cargas en el PoC.

---

## Orden de implementación sugerido

1. Almacén de plantillas + JSON de ejemplo + constructor Zod
2. Renderizado PDF + herramienta de extracción de una etapa
3. `POST /api/extract` sin descubrimiento
4. UI de carga con visor JSON
5. Subagente de descubrimiento + UI admin
6. Validación de coincidencia de plantilla + errores 422
7. Integración de sesión Eve + aprobación humana
8. Bandera de pipeline de dos etapas
9. Desplegar + prueba de humo

---

## ¿Preguntas?

Consulte el glosario de dominio en [CONTEXT.md](../CONTEXT.md) para terminología canónica.

La guía en inglés: [DEVELOPER_GUIDE.en.md](./DEVELOPER_GUIDE.en.md)
