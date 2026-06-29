import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { uploadPdf, type Folder } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Upload · DocuEdit" }, { name: "description", content: "Upload a PDF to edit." }] }),
  component: UploadPage,
});

function UploadPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<Folder>("invoice");
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const doc = await uploadPdf(file, folder, file.name);
      toast.success(`Uploaded ${doc.name}`);
      navigate({ to: "/editor/$id", params: { id: doc.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally { setUploading(false); }
  }

  return (
    <div className="px-8 py-10 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Upload PDF</h1>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type === "application/pdf") handleFile(f); }}
        className="rounded-xl border-2 border-dashed border-border bg-card p-12 text-center"
      >
        <FileUp className="mx-auto h-10 w-10 text-accent" />
        <p className="mt-3 text-base font-medium">Drag & drop a PDF, or browse</p>
        <p className="text-xs text-muted-foreground mt-1">Your file opens immediately in the editor.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Select value={folder} onValueChange={(v) => setFolder(v as Folder)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">Invoices</SelectItem>
              <SelectItem value="quotation">Quotations</SelectItem>
              <SelectItem value="offer_letter">Offer Letters</SelectItem>
              <SelectItem value="template">Templates</SelectItem>
            </SelectContent>
          </Select>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : "Choose PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}