"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { DiscoverySession, Template, TemplateField } from "@/lib/types";

type DiscoveryChatPanelProps = {
  session: DiscoverySession;
  apiKey: string;
  templateKey: string;
  category: Template["category"];
  editedFields: TemplateField[];
  editedSides: DiscoverySession["sides"];
  onTemplateKeyChange: (value: string) => void;
  onFieldChange: (index: number, patch: Partial<TemplateField>, side?: "front" | "back") => void;
  onSessionUpdated: () => void;
  onRevising: (revising: boolean) => void;
  onApprove: (save: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
};

function toUiMessages(messages: Array<{ role: "user" | "assistant"; content: string }>): UIMessage[] {
  return messages.map((message, index) => ({
    id: `seed-${index}`,
    role: message.role,
    parts: [{ type: "text", text: message.content }],
  }));
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function SchemaFieldsTable({
  fields,
  side,
  onFieldChange,
  disabled,
}: {
  fields: TemplateField[];
  side?: "front" | "back";
  onFieldChange: (index: number, patch: Partial<TemplateField>, side?: "front" | "back") => void;
  disabled?: boolean;
}) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No fields proposed yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            {side ? <th className="p-2" scope="col">Side</th> : null}
            <th className="p-2" scope="col">Name</th>
            <th className="p-2" scope="col">Type</th>
            <th className="p-2" scope="col">Required</th>
            <th className="p-2" scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, index) => (
            <tr key={`${side ?? "flat"}-${field.name}-${index}`} className="border-b last:border-b-0">
              {side ? <td className="p-2 capitalize text-muted-foreground">{side}</td> : null}
              <td className="p-2 font-medium">{field.name}</td>
              <td className="p-2">{field.type}</td>
              <td className="p-2">
                <input
                  type="checkbox"
                  checked={field.required}
                  disabled={disabled}
                  onChange={(event) => onFieldChange(index, { required: event.target.checked }, side)}
                  aria-label={`Required: ${field.name}`}
                />
              </td>
              <td className="p-2 text-muted-foreground">{field.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DiscoveryChatPanel({
  session,
  apiKey,
  templateKey,
  category,
  editedFields,
  editedSides,
  onTemplateKeyChange,
  onFieldChange,
  onSessionUpdated,
  onRevising,
  onApprove,
  disabled = false,
  loading = false,
}: DiscoveryChatPanelProps) {
  const [input, setInput] = useState("");
  const [schemaReady, setSchemaReady] = useState(false);
  const [systemEvents, setSystemEvents] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seedMessages = useMemo(() => toUiMessages(session.messages), [session.messages]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/discover/${session.proposalId}/chat`,
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    [apiKey, session.proposalId],
  );

  const { messages, sendMessage, setMessages, status } = useChat({
    id: session.proposalId,
    transport,
    messages: seedMessages,
    onFinish: () => {
      onSessionUpdated();
    },
  });

  useEffect(() => {
    setMessages(seedMessages);
    setSchemaReady(false);
    setSystemEvents([]);
  }, [session.proposalId, seedMessages, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, systemEvents, session.documentSummary, session.revisionCount]);

  const isLoading = status === "streaming" || status === "submitted";

  async function handleReReadDocument() {
    onRevising(true);
    try {
      const response = await fetch(`/api/discover/${session.proposalId}/revise`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) {
        setSystemEvents((prev) => [
          ...prev,
          `Document re-read completed (revision ${session.revisionCount + 1}). Summary and schema updated.`,
        ]);
        onSessionUpdated();
      }
    } finally {
      onRevising(false);
    }
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading || disabled) {
      return;
    }
    setInput("");
    await sendMessage({ text });
  }

  const frontFields = editedSides?.front?.fields ?? [];
  const backFields = editedSides?.back?.fields ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Discovery conversation</h3>
          <p className="text-xs text-muted-foreground">
            Session {session.proposalId} · {category} · {session.revisionCount} re-read
            {session.revisionCount === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleReReadDocument()}
          disabled={disabled || isLoading || loading}
        >
          Re-read document
        </Button>
      </div>

      <ScrollArea className="h-128 rounded-md border border-border bg-muted/20 p-4">
        <div className="flex flex-col gap-4 pr-3">
          <article className="rounded-lg border bg-card p-4 shadow-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Document summary
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {session.documentSummary || "No summary available."}
            </p>
          </article>

          <article className="rounded-lg border bg-card p-4 shadow-sm">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Proposed schema
            </p>
            <div className="mb-3 flex flex-col gap-2">
              <Label htmlFor="conversationTemplateKey">Template key</Label>
              <Input
                id="conversationTemplateKey"
                value={templateKey}
                disabled={disabled || loading}
                onChange={(event) => onTemplateKeyChange(event.target.value)}
              />
            </div>
            {session.paired ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-2 text-sm font-medium">Front</p>
                  <SchemaFieldsTable
                    fields={frontFields}
                    side="front"
                    onFieldChange={onFieldChange}
                    disabled={disabled || loading}
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Back</p>
                  <SchemaFieldsTable
                    fields={backFields}
                    side="back"
                    onFieldChange={onFieldChange}
                    disabled={disabled || loading}
                  />
                </div>
              </div>
            ) : (
              <SchemaFieldsTable
                fields={editedFields}
                onFieldChange={onFieldChange}
                disabled={disabled || loading}
              />
            )}
          </article>

          {systemEvents.map((event) => (
            <div
              key={event}
              className="rounded-md border border-dashed bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            >
              {event}
            </div>
          ))}

          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ask the assistant to refine the schema. It will discuss options first and apply changes after you confirm.
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto border bg-background"
                }`}
              >
                <div className="mb-1 text-xs font-medium opacity-70">
                  {message.role === "user" ? "You" : "Assistant"}
                </div>
                <div className="whitespace-pre-wrap">{messageText(message)}</div>
              </div>
            ))
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <form className="flex flex-col gap-2" onSubmit={(event) => void handleSend(event)}>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder='e.g. "Should we track blood type?" or "Yes, remove blood type and add CUI"'
          disabled={disabled || isLoading || loading}
          rows={3}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled || isLoading || loading || !input.trim()}>
            {isLoading ? "Thinking…" : "Send"}
          </Button>
          <Button
            type="button"
            variant={schemaReady ? "default" : "outline"}
            disabled={disabled || loading}
            onClick={() => setSchemaReady(true)}
          >
            Schema looks good
          </Button>
        </div>
      </form>

      {schemaReady ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="w-full text-sm text-muted-foreground">
            Schema agreed — run extraction against the cached upload or save to the library.
          </p>
          <Button type="button" onClick={() => onApprove(false)} disabled={disabled || loading}>
            Approve &amp; Extract
          </Button>
          <Button type="button" variant="outline" onClick={() => onApprove(true)} disabled={disabled || loading}>
            Save to Library
          </Button>
        </div>
      ) : null}
    </div>
  );
}
