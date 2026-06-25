import { isImage, isPdf, parsePdfBuffer, PdfPageLimitError } from "./pdf";

export type UploadedFile = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  text?: string;
  pageCount?: number;
};

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);

export async function parseUploadFormData(formData: FormData): Promise<UploadedFile[]> {
  const entries = formData.getAll("files");
  if (entries.length === 0) {
    throw new UploadError("missing_files", "At least one file is required");
  }

  const files: UploadedFile[] = [];

  for (const entry of entries) {
    if (!(entry instanceof File)) {
      continue;
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    const sizeMb = buffer.byteLength / (1024 * 1024);
    if (sizeMb > MAX_UPLOAD_MB) {
      throw new UploadError("file_too_large", `File exceeds ${MAX_UPLOAD_MB}MB limit`);
    }

    const mimeType = entry.type || "application/octet-stream";
    const filename = entry.name || "upload";

    if (!isImage(mimeType) && !isPdf(mimeType, filename)) {
      throw new UploadError("unsupported_type", "Only images and PDF are supported");
    }

    const uploaded: UploadedFile = { buffer, mimeType, filename };
    if (isPdf(mimeType, filename)) {
      try {
        const parsed = await parsePdfBuffer(buffer);
        uploaded.text = parsed.text;
        uploaded.pageCount = parsed.pageCount;
      } catch (err) {
        if (err instanceof PdfPageLimitError) {
          throw new UploadError("page_limit_exceeded", err.message);
        }
        throw err;
      }
    }

    files.push(uploaded);
  }

  if (files.length === 0) {
    throw new UploadError("missing_files", "At least one file is required");
  }

  return files;
}

export class UploadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}
