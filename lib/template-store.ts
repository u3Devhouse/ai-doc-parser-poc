import fs from "node:fs/promises";
import path from "node:path";
import type { Template } from "./types";

const EXAMPLE_FILE = "_example.template.json";

function getStoreRoot(): string {
  return process.env.TEMPLATE_STORE_PATH ?? "data/templates";
}

function templatePath(templateKey: string): string {
  return path.join(getStoreRoot(), `${templateKey}.json`);
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== EXAMPLE_FILE) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function getTemplate(templateKey: string): Promise<Template | null> {
  try {
    const raw = await fs.readFile(templatePath(templateKey), "utf8");
    return JSON.parse(raw) as Template;
  } catch {
    return null;
  }
}

export async function saveTemplate(template: Template): Promise<void> {
  const filePath = templatePath(template.templateKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(template, null, 2)}\n`);
}

export async function listTemplates(): Promise<Template[]> {
  const root = getStoreRoot();
  try {
    const files = await walkJsonFiles(root);
    const templates: Template[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, "utf8");
      templates.push(JSON.parse(raw) as Template);
    }
    return templates;
  } catch {
    return [];
  }
}
