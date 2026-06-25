"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage, readJsonResponse } from "@/lib/api-client";

export default function UploadPage() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!files || files.length === 0) {
      setError("Please select at least one file");
      return;
    }

    const formData = new FormData();
    for (const file of Array.from(files)) {
      formData.append("files", file);
    }
    if (templateKey.trim()) {
      formData.set("templateKey", templateKey.trim());
    }

    setLoading(true);
    try {
      const response = await fetch("/api/extract", { method: "POST", body: formData });
      const { payload, parseError } = await readJsonResponse(response);
      if (parseError) {
        setError(parseError);
        return;
      }
      if (!response.ok) {
        setError(apiErrorMessage(payload, "Upload failed"));
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Document Extraction</h1>
        <p className="text-muted-foreground">Upload a source file and view extracted JSON.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="files">Source file(s)</Label>
              <Input
                id="files"
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) => setFiles(e.target.files)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="templateKey">Template key (optional)</Label>
              <Input
                id="templateKey"
                placeholder="contract/nda or identity/GT/dpi"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Extracting…" : "Extract"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
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
