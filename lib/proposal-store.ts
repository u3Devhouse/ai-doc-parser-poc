import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoverProposal, ProposalSummary, SessionMessage } from "./types";

export type ProposalSource = "admin" | "extract";

export type StoredProposal = DiscoverProposal & {
  buffers: Buffer[];
  mimeTypes: string[];
  filenames: string[];
  createdAt: string;
  source: ProposalSource;
  documentSummary: string;
  messages: SessionMessage[];
  revisionCount: number;
};

export type { ProposalSummary };

type ProposalRecord = {
  proposal: DiscoverProposal;
  files: Array<{ filename: string; mimeType: string; dataBase64: string }>;
  createdAt: string;
  source: ProposalSource;
  documentSummary?: string;
  messages?: SessionMessage[];
  revisionCount?: number;
};

function getStoreRoot(): string {
  return process.env.PROPOSAL_STORE_PATH ?? "data/proposals";
}

function proposalPath(proposalId: string): string {
  return path.join(getStoreRoot(), `${proposalId}.json`);
}

function toRecord(stored: StoredProposal): ProposalRecord {
  return {
    proposal: {
      proposalId: stored.proposalId,
      proposedTemplateKey: stored.proposedTemplateKey,
      category: stored.category,
      paired: stored.paired,
      fields: stored.fields,
      sides: stored.sides,
    },
    files: stored.buffers.map((buffer, index) => ({
      filename: stored.filenames[index] ?? `file-${index}`,
      mimeType: stored.mimeTypes[index] ?? "application/octet-stream",
      dataBase64: buffer.toString("base64"),
    })),
    createdAt: stored.createdAt,
    source: stored.source,
    documentSummary: stored.documentSummary,
    messages: stored.messages,
    revisionCount: stored.revisionCount,
  };
}

function fromRecord(record: ProposalRecord): StoredProposal {
  return {
    ...record.proposal,
    buffers: record.files.map((file) => Buffer.from(file.dataBase64, "base64")),
    mimeTypes: record.files.map((file) => file.mimeType),
    filenames: record.files.map((file) => file.filename),
    createdAt: record.createdAt,
    source: record.source,
    documentSummary: record.documentSummary ?? "",
    messages: record.messages ?? [],
    revisionCount: record.revisionCount ?? 0,
  };
}

export async function saveProposal(
  proposal: DiscoverProposal,
  input: {
    buffers: Buffer[];
    mimeTypes: string[];
    filenames: string[];
    documentSummary?: string;
  },
  source: ProposalSource = "admin",
): Promise<void> {
  const root = getStoreRoot();
  await fs.mkdir(root, { recursive: true });

  const stored: StoredProposal = {
    ...proposal,
    buffers: input.buffers,
    mimeTypes: input.mimeTypes,
    filenames: input.filenames,
    createdAt: new Date().toISOString(),
    source,
    documentSummary: input.documentSummary ?? "",
    messages: [],
    revisionCount: 0,
  };

  await fs.writeFile(proposalPath(proposal.proposalId), `${JSON.stringify(toRecord(stored), null, 2)}\n`);
}

export async function getProposal(proposalId: string): Promise<StoredProposal | null> {
  try {
    const raw = await fs.readFile(proposalPath(proposalId), "utf8");
    return fromRecord(JSON.parse(raw) as ProposalRecord);
  } catch {
    return null;
  }
}

export async function updateProposalSession(
  proposalId: string,
  updates: {
    proposal?: Partial<DiscoverProposal>;
    documentSummary?: string;
    messages?: SessionMessage[];
    revisionCount?: number;
  },
): Promise<StoredProposal | null> {
  const stored = await getProposal(proposalId);
  if (!stored) {
    return null;
  }

  const next: StoredProposal = {
    ...stored,
    ...updates.proposal,
    documentSummary: updates.documentSummary ?? stored.documentSummary,
    messages: updates.messages ?? stored.messages,
    revisionCount: updates.revisionCount ?? stored.revisionCount,
  };

  await fs.writeFile(proposalPath(proposalId), `${JSON.stringify(toRecord(next), null, 2)}\n`);
  return next;
}

export async function listProposals(): Promise<ProposalSummary[]> {
  const root = getStoreRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const summaries: ProposalSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const stored = await getProposal(entry.replace(/\.json$/, ""));
    if (!stored) {
      continue;
    }
    summaries.push({
      proposalId: stored.proposalId,
      proposedTemplateKey: stored.proposedTemplateKey,
      category: stored.category,
      paired: stored.paired,
      fields: stored.fields,
      sides: stored.sides,
      createdAt: stored.createdAt,
      source: stored.source,
    });
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteProposal(proposalId: string): Promise<void> {
  try {
    await fs.unlink(proposalPath(proposalId));
  } catch {
    // already removed
  }
}
