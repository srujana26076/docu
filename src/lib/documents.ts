import { supabase } from "@/integrations/supabase/client";

export type Folder = "invoice" | "quotation" | "offer_letter" | "template";

export const folderMeta: Record<Folder, { title: string; slug: string; description: string }> = {
  invoice: { title: "Invoices", slug: "invoices", description: "Bills and invoices" },
  quotation: { title: "Quotations", slug: "quotations", description: "Price quotes for clients" },
  offer_letter: { title: "Offer Letters", slug: "offer-letters", description: "Employment offers" },
  template: { title: "Templates", slug: "templates", description: "Reusable document templates" },
};

export interface DocRow {
  id: string;
  name: string;
  folder: Folder;
  storage_path: string;
  is_default: boolean;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  tables_json?: any;
}

export async function listDocuments(folder?: Folder): Promise<DocRow[]> {
  let q = supabase.from("documents").select("*").order("created_at", { ascending: false });
  if (folder) q = q.eq("folder", folder);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DocRow[];
}

export async function getDocument(id: string): Promise<DocRow> {
  const { data, error } = await supabase.from("documents").select("*").eq("id", id).single();
  if (error) throw error;
  return data as DocRow;
}

export async function downloadPdfBytes(storagePath: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from("documents").download(storagePath);
  if (error) throw error;
  return await data.arrayBuffer();
}

export async function uploadPdf(file: File | Blob, folder: Folder, name: string): Promise<DocRow> {
  const safe = name.replace(/[^\w.\- ]+/g, "_").trim() || `untitled-${Date.now()}`;
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;
  const size = (file as File).size ?? null;
  const { data, error } = await supabase
    .from("documents")
    .insert({ name: safe.replace(/\.pdf$/i, ""), folder, storage_path: path, size_bytes: size, is_default: false })
    .select()
    .single();
  if (error) throw error;
  return data as DocRow;
}

export async function deleteDocument(doc: DocRow) {
  if (doc.is_default) throw new Error("Default files cannot be deleted");
  await supabase.storage.from("documents").remove([doc.storage_path]);
  // Remove any accounting entries tied to this document (DB also cascades).
  await supabase.from("ledger_entries").delete().eq("document_id", doc.id);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  if (error) throw error;
}

export async function renameDocument(id: string, name: string) {
  const { error } = await supabase.from("documents").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Signed, shareable URL to the stored PDF (valid 7 days). */
export async function createShareLink(doc: DocRow, days = 7): Promise<string> {
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, days * 24 * 60 * 60, { download: `${doc.name}.pdf` });
  if (error) throw error;
  return data.signedUrl;
}

/** Grand total taken from the invoice table's "Total (Inclusive of taxes):" row. */
export function invoiceTotal(doc: DocRow): string {
  try {
    const tables = (doc.tables_json ?? []) as any[];
    for (const t of tables) {
      for (const row of t?.cells ?? []) {
        const isTotal = row.some((c: any) => typeof c?.text === "string" && c.text.startsWith("Total (Inclusive"));
        if (isTotal) {
          const last = row[row.length - 1]?.text?.trim();
          if (last) return last;
        }
      }
    }
  } catch { /* ignore */ }
  return "";
}