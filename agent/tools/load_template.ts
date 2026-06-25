import { getTemplate } from "@/lib/template-store";

export async function loadTemplate(templateKey: string) {
  const template = await getTemplate(templateKey);
  if (!template) {
    throw new Error(`Template not found: ${templateKey}`);
  }
  return template;
}
