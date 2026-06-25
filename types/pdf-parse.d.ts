declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }

  interface PdfParseOptions {
    max?: number;
  }

  function pdfParse(buffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
