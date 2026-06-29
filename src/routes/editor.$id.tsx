import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDocument } from "@/lib/documents";
import { PdfEditor } from "@/components/PdfEditor";

export const Route = createFileRoute("/editor/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "Edit document · DocuEdit" }, { name: "description", content: "Edit a PDF document." }] }),
  component: EditorPage,
});

function EditorPage() {
  const { id } = useParams({ from: "/editor/$id" });
  const q = useQuery({ queryKey: ["doc", id], queryFn: () => getDocument(id) });
  if (q.isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading document…</div>;
  if (q.error) return <div className="p-10 text-sm text-destructive">Failed to load document.</div>;
  if (!q.data) return null;
  return <PdfEditor doc={q.data} />;
}