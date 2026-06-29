import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listDocuments, folderMeta } from "@/lib/documents";
import { FileText, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/recent")({
  head: () => ({ meta: [{ title: "Recent Documents · DocuEdit" }, { name: "description", content: "All recently saved and edited PDFs." }] }),
  component: RecentPage,
});

function RecentPage() {
  const q = useQuery({ queryKey: ["recent-all"], queryFn: () => listDocuments() });
  return (
    <div className="px-8 py-10 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Recent Documents</h1>
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {q.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {q.data?.length === 0 && <div className="p-6 text-sm text-muted-foreground">No documents yet.</div>}
        {q.data?.map((d) => (
          <Link key={d.id} to="/editor/$id" params={{ id: d.id }} className="flex items-center justify-between px-4 py-3 hover:bg-muted">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-xs text-muted-foreground">{folderMeta[d.folder].title} · {new Date(d.created_at).toLocaleString()}</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}