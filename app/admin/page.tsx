"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DiscoveryChatPanel } from "@/components/admin/discovery-chat-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DiscoverySession, ProposalSummary, Template, TemplateField } from "@/lib/types";
import { apiErrorMessage, readJsonResponse } from "@/lib/api-client";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

function cloneSides(sides: DiscoverySession["sides"]): DiscoverySession["sides"] {
  if (!sides) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(sides)) as DiscoverySession["sides"];
}

export default function AdminPage() {
  const [apiKey, setApiKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [editedFields, setEditedFields] = useState<TemplateField[]>([]);
  const [editedSides, setEditedSides] = useState<DiscoverySession["sides"]>(undefined);
  const [templateKey, setTemplateKey] = useState("");
  const [category, setCategory] = useState<Template["category"]>("contract");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revising, setRevising] = useState(false);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${apiKey}` };
  }

  const loadProposals = useCallback(async () => {
    const response = await fetch("/api/discover", { headers: authHeaders() });
    const { payload, parseError } = await readJsonResponse(response);
    if (parseError) {
      setError(parseError);
      return;
    }
    if (!response.ok) {
      setError(apiErrorMessage(payload, "Failed to load proposals"));
      return;
    }
    setProposals((payload?.proposals as ProposalSummary[] | undefined) ?? []);
  }, [apiKey]);

  const loadSession = useCallback(
    async (proposalId: string) => {
      const response = await fetch(`/api/discover/${proposalId}`, { headers: authHeaders() });
      const { payload, parseError } = await readJsonResponse(response);
      if (parseError) {
        setError(parseError);
        return;
      }
      if (!response.ok) {
        setError(apiErrorMessage(payload, "Failed to load session"));
        return;
      }
      const loaded = payload as unknown as DiscoverySession;
      setSession(loaded);
      setTemplateKey(loaded.proposedTemplateKey);
      setCategory(loaded.category);
      setEditedFields(loaded.fields ?? []);
      setEditedSides(cloneSides(loaded.sides));
      setResult(null);
      setError(null);
    },
    [apiKey],
  );

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    void loadProposals();
  }, [authenticated, loadProposals]);

  function selectProposal(summary: ProposalSummary) {
    void loadSession(summary.proposalId);
  }

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) {
      setError("API key required");
      return;
    }
    setAuthenticated(true);
    setError(null);
  }

  async function handleDiscover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files || files.length === 0) {
      setError("Select a file to discover");
      return;
    }

    const formData = new FormData();
    for (const file of Array.from(files)) {
      formData.append("files", file);
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const { payload, parseError } = await readJsonResponse(response);
      if (parseError) {
        setError(parseError);
        return;
      }
      if (!response.ok) {
        setError(apiErrorMessage(payload, "Discovery failed"));
        return;
      }
      const created = payload as unknown as DiscoverySession;
      await loadSession(created.proposalId);
      await loadProposals();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setLoading(false);
    }
  }

  const persistDraft = useCallback(
    async (draft: {
      proposedTemplateKey: string;
      category: Template["category"];
      fields?: TemplateField[];
      paired: boolean;
      sides?: DiscoverySession["sides"];
    }) => {
      if (!session) {
        return;
      }
      await fetch(`/api/discover/${session.proposalId}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
    },
    [apiKey, session],
  );

  function scheduleDraftSave(draft: {
    proposedTemplateKey: string;
    category: Template["category"];
    fields?: TemplateField[];
    paired: boolean;
    sides?: DiscoverySession["sides"];
  }) {
    if (!session) {
      return;
    }
    if (draftSaveTimer.current) {
      clearTimeout(draftSaveTimer.current);
    }
    draftSaveTimer.current = setTimeout(() => {
      void persistDraft(draft);
    }, 400);
  }

  function currentDraft() {
    if (!session) {
      return null;
    }
    if (session.paired) {
      return {
        proposedTemplateKey: templateKey,
        category,
        paired: true as const,
        sides: editedSides,
      };
    }
    return {
      proposedTemplateKey: templateKey,
      category,
      paired: false as const,
      fields: editedFields,
    };
  }

  function updateField(index: number, patch: Partial<TemplateField>, side?: "front" | "back") {
    if (!session) {
      return;
    }

    if (session.paired && side) {
      setEditedSides((prev) => {
        const next = cloneSides(prev) ?? {};
        const fields = [...(next[side]?.fields ?? [])];
        fields[index] = { ...fields[index], ...patch };
        next[side] = { fields };
        scheduleDraftSave({
          proposedTemplateKey: templateKey,
          category,
          paired: true,
          sides: next,
        });
        return next;
      });
      return;
    }

    setEditedFields((prev) => {
      const next = prev.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field));
      scheduleDraftSave({
        proposedTemplateKey: templateKey,
        category,
        paired: false,
        fields: next,
      });
      return next;
    });
  }

  function handleTemplateKeyChange(value: string) {
    setTemplateKey(value);
    const draft = currentDraft();
    if (!draft) {
      return;
    }
    scheduleDraftSave({ ...draft, proposedTemplateKey: value });
  }

  async function handleApprove(save: boolean) {
    if (!session) {
      return;
    }

    const template: Template = session.paired
      ? {
          templateKey,
          category,
          version: 1,
          paired: true,
          sides: editedSides,
        }
      : {
          templateKey,
          category,
          version: 1,
          paired: false,
          fields: editedFields,
        };

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/discover/${session.proposalId}/approve`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ template, save }),
      });
      const { payload, parseError } = await readJsonResponse(response);
      if (parseError) {
        setError(parseError);
        return;
      }
      if (!response.ok) {
        setError(apiErrorMessage(payload, "Approve failed"));
        return;
      }
      setResult(payload);
      setSession(null);
      await loadProposals();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Admin Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleLogin}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiKey">Admin API key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <Button type="submit">Continue</Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Schema Discovery Admin</h1>
        <p className="text-muted-foreground">
          One conversation thread: summary, proposed fields, chat refinement, re-read, then approve.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pending sessions</CardTitle>
          <Button type="button" variant="outline" onClick={() => void loadProposals()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending sessions. Create one below or upload without a template key on the home page.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {proposals.map((item) => (
                <li key={item.proposalId}>
                  <button
                    type="button"
                    className={`w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted ${
                      session?.proposalId === item.proposalId ? "border-primary bg-muted" : ""
                    }`}
                    onClick={() => selectProposal(item)}
                  >
                    <div className="font-medium">{item.proposedTemplateKey}</div>
                    <div className="text-muted-foreground">
                      {item.proposalId} · {item.source} · {formatWhen(item.createdAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discover schema</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleDiscover}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adminFiles">Source file</Label>
              <Input
                id="adminFiles"
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) => setFiles(e.target.files)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Discovering…" : "Start discovery session"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {session ? (
        <Card>
          <CardHeader>
            <CardTitle>Session: {session.proposalId}</CardTitle>
          </CardHeader>
          <CardContent>
            <DiscoveryChatPanel
              session={session}
              apiKey={apiKey}
              templateKey={templateKey}
              category={category}
              editedFields={editedFields}
              editedSides={editedSides}
              onTemplateKeyChange={handleTemplateKeyChange}
              onFieldChange={updateField}
              onSessionUpdated={() => void loadSession(session.proposalId)}
              onRevising={setRevising}
              onApprove={(save) => void handleApprove(save)}
              disabled={loading || revising}
              loading={loading}
            />
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-destructive">{error}</p> : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Extraction result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md bg-muted p-4 text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
