import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClientFormDialog } from "@/components/ClientForm";
import { listClients, createClient, updateClient, deleteClient, type Client } from "@/lib/clients";
import { Users, Pencil, Trash2, UserPlus } from "lucide-react";

function ClientsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["clients"], queryFn: listClients });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["clients"] });

  async function remove(c: Client) {
    if (!confirm(`Delete client "${c.name}"? Linked documents stay, but lose the link.`)) return;
    try { await deleteClient(c.id); toast.success("Client deleted"); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  }

  return (
    <div className="px-8 py-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">Saved client details for invoices and quotations</p>
        </div>
        <Button onClick={() => setAdding(true)}><UserPlus className="h-4 w-4 mr-2" />Add Client</Button>
      </div>

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {q.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {q.data?.length === 0 && <div className="p-6 text-sm text-muted-foreground">No clients yet. Click "Add Client".</div>}
        {q.data?.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <Users className="h-5 w-5 text-muted-foreground shrink-0" />
            <Link to="/clients/$id" params={{ id: c.id }} className="min-w-0 flex-1 hover:underline">
              <div className="text-sm font-medium truncate">{c.name}</div>
              <div className="text-xs text-muted-foreground truncate">{c.email} · {c.phone}</div>
            </Link>
            <Button size="sm" variant="outline" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>

      <ClientFormDialog
        open={adding} onOpenChange={setAdding} title="Add client"
        onSubmit={async (input) => { await createClient(input); toast.success("Client added"); refresh(); }}
      />
      {editing && (
        <ClientFormDialog
          key={editing.id} open onOpenChange={(v) => !v && setEditing(null)} initial={editing} title="Edit client"
          onSubmit={async (input) => { await updateClient(editing.id, input); toast.success("Client updated"); refresh(); }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute("/clients/")({
  head: () => ({ meta: [
    { title: "Clients · DocuEdit" },
    { name: "description", content: "Save client details once and reuse them across invoices and quotations." },
    { property: "og:title", content: "Clients · DocuEdit" },
    { property: "og:description", content: "Manage client records and see their invoice history." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ClientsPage,
});
