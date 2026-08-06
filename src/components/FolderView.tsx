import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { listDocuments, uploadPdf, deleteDocument, downloadPdfBytes, createShareLink, invoiceTotal, type DocRow, type Folder, folderMeta } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileText, FileUp, Trash2, Download, Pencil, Share2, MessageCircle, Mail } from "lucide-react";
import { toast } from "sonner";

function triggerDownload(bytes: ArrayBuffer, name: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".pdf") ? name : `${name}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function FolderView({ folder }: { folder: Folder }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = folderMeta[folder];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const q = useQuery({ queryKey: ["folder", folder], queryFn: () => listDocuments(folder) });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const doc = await uploadPdf(file, folder, file.name);
      toast.success(`Uploaded ${doc.name}`);
      qc.invalidateQueries({ queryKey: ["folder", folder] });
      qc.invalidateQueries({ queryKey: ["recent"] });
      navigate({ to: "/editor/$id", params: { id: doc.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: DocRow) {
    try {
      const bytes = await downloadPdfBytes(doc.storage_path);
      triggerDownload(bytes, doc.name);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  }

  async function handleDelete(doc: DocRow) {
    if (doc.is_default) return toast.error("Default files cannot be deleted");
    if (!confirm(`Delete "${doc.name}"?`)) return;
    try {
      await deleteDocument(doc);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["folder", folder] });
      qc.invalidateQueries({ queryKey: ["recent"] });
      qc.invalidateQueries({ queryKey: ["ledger-entries"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  async function handleShare(doc: DocRow, via: "whatsapp" | "email") {
    try {
      const link = await createShareLink(doc);
      const number = doc.invoice_number || doc.name;
      const amount = invoiceTotal(doc);
      const amountText = amount ? ` for ₹${amount}` : "";
      if (via === "whatsapp") {
        const msg = `Hi, please find your invoice ${number}${amountText}. Download here: ${link}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
      } else {
        const subject = `Invoice ${number} from Harsha Perfect Solutions`;
        const body = `Hi,\n\nPlease find your invoice ${number}${amountText}.\n\nDownload here: ${link}\n\nRegards,\nHarsha Perfect Solutions`;
        window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create share link");
    }
  }

  const uploadLabel = folder === "invoice" ? "Upload Invoice"
    : folder === "template" ? "Upload Template"
    : folder === "quotation" ? "Upload Quotation"
    : "Upload Offer Letter";

  return (
    <div className="px-8 py-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          <FileUp className="h-4 w-4 mr-2" />
          {uploading ? "Uploading…" : uploadLabel}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {q.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {q.data?.length === 0 && <div className="p-6 text-sm text-muted-foreground">No files yet. Click "{uploadLabel}" to add one.</div>}
        {q.data?.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate flex items-center gap-2">
                {d.name}
                {d.is_default && <span className="text-[10px] uppercase tracking-wider text-accent px-1.5 py-0.5 rounded bg-accent/10">default</span>}
              </div>
              <div className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}{d.size_bytes ? ` · ${(d.size_bytes/1024).toFixed(0)} KB` : ""}</div>
            </div>
            <Link to="/editor/$id" params={{ id: d.id }}>
              <Button size="sm" variant="default"><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit</Button>
            </Link>
            <Button size="sm" variant="outline" onClick={() => handleDownload(d)}><Download className="h-3.5 w-3.5" /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" title="Share"><Share2 className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleShare(d, "whatsapp")}>
                  <MessageCircle className="h-4 w-4 mr-2" />Share via WhatsApp
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleShare(d, "email")}>
                  <Mail className="h-4 w-4 mr-2" />Share via Email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" disabled={d.is_default} onClick={() => handleDelete(d)} title={d.is_default ? "Default files can't be deleted" : "Delete"}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}