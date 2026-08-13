import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getClient } from "@/lib/clients";
import { folderMeta, invoiceTotal, type DocRow } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { FileText, ArrowLeft, Pencil } from "lucide-react";

async function listClientDocuments(clientId: string): Promise<DocRow[]> {
  const { data, error } = await supabase.from("documents").select("*")
    .eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocRow[];
}

function ClientDetail() {
  const { id } = Route.useParams();
  const client = useQuery({ queryKey: ["client", id], queryFn: () => getClient(id) });
  const docs = useQuery({ queryKey: ["client-documents", id], queryFn: () => listClientDocuments(id) });

  const rows = docs.data ?? [];
  const total = rows.reduce((sum, d) => {
    const n = parseFloat(invoiceTotal(d).replace(/[^0-9.]/g, ""));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  return (
    <div className="px-8 py-10 max-w-6xl mx-auto">
      <Link to="/clients" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />All clients
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{client.data?.name ?? "Client"}</h1>
      {client.data && (
        <p className="text-sm text-muted-foreground">
          {client.data.email} · {client.data.phone}
          {client.data.address ? ` · ${client.data.address}` : ""}
          {client.data.gstin ? ` · GSTIN ${client.data.gstin}` : ""}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 my-6 max-w-md">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Documents</div>
          <div className="text-xl font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total invoiced</div>
          <div className="text-xl font-semibold">₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {docs.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {!docs.isLoading && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No documents linked to this client yet.</div>
        )}
        {rows.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{d.invoice_number ? `${d.invoice_number} · ` : ""}{d.name}</div>
              <div className="text-xs text-muted-foreground">
                {folderMeta[d.folder].title} · {new Date(d.created_at).toLocaleString()}
                {invoiceTotal(d) ? ` · ${invoiceTotal(d)}` : ""}
              </div>
            </div>
            <Link to="/editor/$id" params={{ id: d.id }}>
              <Button size="sm"><Pencil className="h-3.5 w-3.5 mr-1.5" />Open</Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/clients/$id")({
  head: () => ({ meta: [
    { title: "Client history · DocuEdit" },
    { name: "description", content: "Invoices and quotations linked to this client, with totals." },
    { property: "og:title", content: "Client history · DocuEdit" },
    { property: "og:description", content: "See every document invoiced to this client." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ClientDetail,
});
