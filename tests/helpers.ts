import fs from "node:fs/promises";
import path from "node:path";

const EPHEMERAL_DIRS = ["data/uploads", "data/extractions", "tmp"];

export async function assertNoEphemeralFilesWritten(
  projectRoot: string,
  allowedPaths: string[] = [],
): Promise<void> {
  const allowed = new Set(allowedPaths.map((p) => path.resolve(projectRoot, p)));
  const suspicious: string[] = [];

  for (const rel of EPHEMERAL_DIRS) {
    const dir = path.join(projectRoot, rel);
    try {
      const entries = await fs.readdir(dir, { recursive: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, String(entry));
        if (![...allowed].some((a) => fullPath.startsWith(a))) {
          suspicious.push(fullPath);
        }
      }
    } catch {
      // directory does not exist — expected for ephemeral storage
    }
  }

  if (suspicious.length > 0) {
    throw new Error(`Ephemeral files written: ${suspicious.join(", ")}`);
  }
}
