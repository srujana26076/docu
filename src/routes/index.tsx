import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { listDocuments, uploadPdf, folderMeta, type Folder } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUp, FileText, Briefcase, FileSpreadsheet, LayoutTemplate, Clock, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DocuEdit — PDF editor & document workspace" },
      { name: "description", content: "Upload, edit, save and organize invoices, quotations, offer letters and templates." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<Folder>("invoice");
  const [uploading, setUploading] = useState(false);

  const recent = useQuery({ queryKey: ["recent"], queryFn: () => listDocuments() });

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const doc = await uploadPdf(file, folder, file.name);
      toast.success(`Uploaded ${doc.name}`);
      navigate({ to: "/editor/$id", params: { id: doc.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Document Workspace</h1>
        <p className="text-muted-foreground mt-1">Upload a PDF to edit, or open a document from your folders.</p>
      </header>

      {/* Upload card */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && f.type === "application/pdf") handleFile(f);
        }}
        className="rounded-xl border-2 border-dashed border-border bg-card p-10 text-center"
      >
        <div className="mx-auto h-14 w-14 rounded-full bg-accent/10 flex items-center justify-center text-accent">
          <FileUp className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-medium">Upload a PDF to start editing</h2>
        <p className="text-sm text-muted-foreground mt-1">Drag & drop a file here, or choose one from your computer.</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Save to folder:</span>
            <Select value={folder} onValueChange={(v) => setFolder(v as Folder)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Invoices</SelectItem>
                <SelectItem value="quotation">Quotations</SelectItem>
                <SelectItem value="offer_letter">Offer Letters</SelectItem>
                <SelectItem value="template">Templates</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : "Choose PDF"}
          </Button>
        </div>
      </div>

      {/* Folder shortcuts */}
      <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { f: "invoice" as Folder, Icon: FileText },
          { f: "quotation" as Folder, Icon: FileSpreadsheet },
          { f: "offer_letter" as Folder, Icon: Briefcase },
          { f: "template" as Folder, Icon: LayoutTemplate },
        ].map(({ f, Icon }) => (
          <Link key={f} to={`/${folderMeta[f].slug}` as any}
            className="group rounded-lg border border-border bg-card p-4 hover:border-accent transition-colors">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-accent" />
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent" />
            </div>
            <div className="mt-3 text-sm font-medium">{folderMeta[f].title}</div>
            <div className="text-xs text-muted-foreground">{folderMeta[f].description}</div>
          </Link>
        ))}
      </div>

      {/* Recent */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium flex items-center gap-2"><Clock className="h-4 w-4" /> Recent documents</h3>
          <Link to="/recent" className="text-sm text-accent hover:underline">View all</Link>
        </div>
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {recent.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
          {recent.data?.slice(0, 6).map((d) => (
            <Link key={d.id} to="/editor/$id" params={{ id: d.id }} className="flex items-center justify-between px-4 py-3 hover:bg-muted">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.name}{d.is_default && <span className="ml-2 text-[10px] uppercase tracking-wider text-accent">default</span>}</div>
                  <div className="text-xs text-muted-foreground">{folderMeta[d.folder].title} · {new Date(d.created_at).toLocaleDateString()}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
          {recent.data?.length === 0 && <div className="p-4 text-sm text-muted-foreground">No documents yet.</div>}
        </div>
      </section>
    </div>
  );
}
