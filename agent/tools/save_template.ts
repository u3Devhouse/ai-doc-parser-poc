import { saveTemplate } from "@/lib/template-store";
import type { Template } from "@/lib/types";

let pendingApproval: Template | null = null;

export function requestTemplateSave(template: Template): { status: "pending_approval"; templateKey: string } {
  pendingApproval = template;
  return { status: "pending_approval", templateKey: template.templateKey };
}

export async function approveAndSaveTemplate(): Promise<{ saved: boolean; templateKey: string }> {
  if (!pendingApproval) {
    throw new Error("No template pending approval");
  }
  await saveTemplate(pendingApproval);
  const templateKey = pendingApproval.templateKey;
  pendingApproval = null;
  return { saved: true, templateKey };
}

export function rejectPendingTemplate(): void {
  pendingApproval = null;
}
