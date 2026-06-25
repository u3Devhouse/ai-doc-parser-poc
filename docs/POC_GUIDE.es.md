# Guía paso a paso del PoC

Esta guía explica cómo instalar, configurar y usar el PoC de Extracción de Documentos.

## Requisitos previos

- Node.js 20+
- pnpm
- Cuenta de Vercel con [AI Gateway](https://vercel.com/ai-gateway) habilitado
- Clave API de AI Gateway

Consulte [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md) para los requisitos completos.

---

## Paso 1 — Crear el proyecto (scaffold)

```bash
npx eve@latest init document-extraction-poc --channel-web-nextjs
cd document-extraction-poc
pnpm install
```

> Si ya tiene este repositorio, ejecute `pnpm install` desde la raíz del proyecto.

Copie la plantilla de entorno:

```bash
cp .env.example .env.local
```

Configure como mínimo:

```bash
AI_GATEWAY_API_KEY=your_key_here   # omitir si usa el modo mock indicado abajo
AI_GATEWAY_MOCK=true               # desarrollo local sin clave Gateway (JSON mock determinista)
ADMIN_API_KEY=choose_a_strong_secret
```

Para **probar el frontend localmente sin clave Gateway**, mantenga `AI_GATEWAY_MOCK=true` (valor por defecto en `.env.example`). Establezca `AI_GATEWAY_MOCK=false` y proporcione `AI_GATEWAY_API_KEY` cuando quiera respuestas de modelos reales.

---

## Paso 2 — Iniciar el servidor de desarrollo

```bash
pnpm dev
```

Abra:

| URL | Propósito |
|-----|-----------|
| `http://localhost:3000` | UI de carga |
| `http://localhost:3000/admin` | Administrador de esquemas (Flujo de Descubrimiento) |

---

## Paso 3 — Entender los dos flujos

### Flujo de Descubrimiento (tipo de documento desconocido)

Úselo cuando **no existe plantilla** en la biblioteca y el remitente **no** especifica `templateKey`.

1. Cargue un documento (imagen o PDF).
2. El sistema propone un **esquema** (campos + tipos).
3. El **administrador** revisa en `/admin` — edita campos, marca requeridos, aprueba.
4. El sistema ejecuta la **extracción** contra el esquema aprobado.
5. El administrador puede **guardar la plantilla** en `data/templates/` para uso futuro en el Flujo de Extracción.
6. La respuesta incluye **esquema JSON + datos extraídos**.

### Flujo de Extracción (tipo de documento conocido)

Úselo cuando ya **existe una plantilla** en la biblioteca o el remitente envía `templateKey`.

1. Cargue el documento (opcionalmente indique `templateKey`).
2. El sistema valida que el documento coincida con el tipo (si se envió `templateKey`).
3. El sistema extrae usando el esquema de la biblioteca.
4. La respuesta incluye **esquema JSON + datos extraídos**.

Si no hay plantilla coincidente y no se envió `templateKey` → se usa el **Flujo de Descubrimiento**.

---

## Paso 4 — Carga mediante la UI web

1. Vaya a `http://localhost:3000`.
2. Elija archivos (imagen o PDF).
3. **Opcional:** Seleccione o escriba un `templateKey` (p. ej. `contract/nda` o `identity/GT/dpi`).
   - Déjelo vacío para auto-detectar o entrar al Flujo de Descubrimiento.
4. Para documentos de identidad con plantilla emparejada (p. ej. DPI de Guatemala), cargue **frente y reverso** en un solo envío (dos imágenes o un PDF de 2 páginas).
5. Haga clic en **Extract**.
6. Vea el resultado JSON en el panel de respuesta.

### Forma esperada de respuesta exitosa

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

## Paso 5 — Carga mediante la API

### Extracción con plantilla especificada

```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: multipart/form-data" \
  -F "templateKey=contract/nda" \
  -F "files=@./samples/nda.pdf"
```

### Extracción sin plantilla (auto o descubrimiento)

```bash
curl -X POST http://localhost:3000/api/extract \
  -F "files=@./samples/unknown-doc.pdf"
```

### Descubrimiento — iniciar propuesta

```bash
curl -X POST http://localhost:3000/api/discover \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -F "files=@./samples/new-contract.pdf"
```

---

## Paso 6 — Admin: Discovery Session (conversacional)

1. Abra `http://localhost:3000/admin`.
2. Autentíquese con las credenciales de administrador (`ADMIN_API_KEY`).
3. Cargue un archivo fuente y haga clic en **Start discovery session** (o abra una sesión pendiente del listado).
4. Trabaje en el **hilo de conversación unificado**:
   - Lea el **resumen del documento** arriba (lo que el sistema vio: diseño, lados, etiquetas).
   - Revise la tabla del **esquema propuesto** en línea (frente/reverso para identidad emparejada).
   - Chatee para refinar el esquema — el asistente hace preguntas aclaratorias primero y aplica cambios tras su confirmación (p. ej. «sí, quita el tipo de sangre»).
   - Haga clic en **Re-read document** para re-analizar la carga en caché; el resumen y el esquema se actualizan en el mismo hilo.
5. Active **required** en los campos obligatorios.
6. Haga clic en **Schema looks good** cuando el borrador esté listo.
7. Haga clic en **Approve & Extract** — ejecuta la Extracción Estructurada contra el archivo fuente en caché.
8. O haga clic en **Save to library** — escribe `data/templates/{templateKey}.json` y elimina la sesión.

El chat, el resumen y la tabla de campos permanecen sincronizados. No necesita volver a cargar el archivo entre iteraciones.

---

## Paso 7 — Crear una plantilla manualmente (sin Descubrimiento)

1. Copie el archivo de ejemplo:

   ```bash
   cp data/templates/_example.template.json data/templates/contract/nda.json
   ```

2. Edite los campos para su tipo de documento.
3. Reinicie el servidor de desarrollo si las plantillas se cargan al inicio (o use el endpoint de recarga en caliente).
4. Pruebe el Flujo de Extracción con `templateKey=contract/nda`.

Consulte `_example.template.json` para la estructura de plantillas de identidad emparejada.

---

## Paso 8 — Errores y reintentos

| Error | Significado | Acción |
|-------|-------------|--------|
| `type_mismatch` (422) | El archivo no coincide con el `templateKey` seleccionado | Corrija la selección o cargue el archivo correcto |
| `unreadable` (422) | Documento demasiado borroso o truncado | Reintente con un escaneo de mejor calidad |
| `incomplete` (422) | Documento de identidad emparejado sin frente/reverso | Cargue ambos lados en un solo envío |
| `template_not_found` (404) | `templateKey` no está en la biblioteca | Ejecute el Flujo de Descubrimiento o cree la plantilla |

**Política de reintento:** Descarte la carga fallida; envíe un archivo nuevo. No se conserva estado parcial.

---

## Paso 9 — Habilitar extracción en dos etapas (opcional)

Para escaneos difíciles o PDFs legales extensos:

```bash
# .env.local
EXTRACTION_PIPELINE=two-stage
VISION_MODEL=openai/gpt-4o
STRUCTURE_MODEL=openai/gpt-4o-mini
```

Reinicie el servidor de desarrollo. La extracción:

1. Ejecuta el modelo de visión → texto bruto + notas de diseño.
2. Ejecuta el modelo de estructura → JSON acotado al esquema.

Consulte [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md) para detalles de modelos.

---

## Paso 10 — Desplegar en Vercel

```bash
vercel link
vercel env add AI_GATEWAY_API_KEY
vercel env add ADMIN_API_KEY
vercel deploy
```

Verifique:

- La UI de carga carga en la URL de producción.
- `/admin` está protegido.
- La extracción devuelve JSON; no se persisten archivos en el servidor.

---

## Referencia rápida — árbol de decisión de flujos

```
Carga recibida
    │
    ├─ ¿templateKey proporcionado?
    │       ├─ SÍ → validar coincidencia → extraer O 422 type_mismatch
    │       └─ NO  → ¿plantilla en biblioteca?
    │                   ├─ SÍ → extraer
    │                   └─ NO  → Flujo de Descubrimiento
    │
    └─ ¿legible y completo (reglas emparejadas)?
            ├─ SÍ → devolver JSON { schema, data }
            └─ NO  → 422 → pedir al usuario que reintente la carga
```

---

## Próximos pasos para desarrolladores

- Detalles de implementación: [DEVELOPER_GUIDE.en.md](./DEVELOPER_GUIDE.en.md) (English) / [DEVELOPER_GUIDE.es.md](./DEVELOPER_GUIDE.es.md) (Español)
- Modelos e infraestructura: [MODELS_AND_REQUIREMENTS.md](./MODELS_AND_REQUIREMENTS.md)
- Glosario de dominio: [CONTEXT.md](../CONTEXT.md)

Guía en inglés: [POC_GUIDE.md](./POC_GUIDE.md)
