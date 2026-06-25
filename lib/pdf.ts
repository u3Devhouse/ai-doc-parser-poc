// pdf-parse has no types in some versions
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfParse from "pdf-parse";

export class PdfPageLimitError extends Error {
  constructor(public readonly pageCount: number, public readonly maxPages: number) {
    super(`PDF exceeds page limit: ${pageCount} pages (max ${maxPages})`);
    this.name = "PdfPageLimitError";
  }
}

export type ParsedPdf = {
  text: string;
  pageCount: number;
  pageTexts: string[];
};

function getMaxPages(): number {
  return Number(process.env.MAX_PDF_PAGES ?? 20);
}

function getRenderScale(): number {
  return Number(process.env.PDF_RENDER_SCALE ?? 2);
}

export async function renderPdfPagesToImages(buffer: Buffer): Promise<Buffer[]> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const maxPages = getMaxPages();
  const scale = getRenderScale();
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;

  if (pdf.numPages > maxPages) {
    throw new PdfPageLimitError(pdf.numPages, maxPages);
  }

  const images: Buffer[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    images.push(canvas.toBuffer("image/png"));
  }

  return images;
}

export async function parsePdfPagesToText(buffer: Buffer): Promise<string[]> {
  const maxPages = getMaxPages();

  try {
    const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;

    if (pdf.numPages > maxPages) {
      throw new PdfPageLimitError(pdf.numPages, maxPages);
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(text);
    }

    return pages;
  } catch {
    const legacy = await pdfParse(buffer, { max: maxPages + 1 });
    if (legacy.numpages > maxPages) {
      throw new PdfPageLimitError(legacy.numpages, maxPages);
    }
    return [legacy.text];
  }
}

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedPdf> {
  const pageTexts = await parsePdfPagesToText(buffer);
  const text = pageTexts.join("\n\n");
  return { text, pageCount: pageTexts.length, pageTexts };
}

export async function parsePdfToText(buffer: Buffer): Promise<string> {
  const parsed = await parsePdfBuffer(buffer);
  return parsed.text;
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const parsed = await parsePdfBuffer(buffer);
  return parsed.pageCount;
}

export function isPdf(mimeType: string, filename: string): boolean {
  return mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
