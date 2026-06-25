import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Document Extraction PoC",
  description: "Upload documents and extract structured JSON",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
