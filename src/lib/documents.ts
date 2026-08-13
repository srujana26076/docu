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
  payment_status?: "unpaid" | "paid" | "overdue" | null;
  due_date?: string | null;
  subfolder_id?: string | null;
  client_id?: string | null;
}

export interface SubfolderRow {
  id: string;
  name: string;
  folder: Folder;
  created_at: string;
}

/** All sub-folders, optionally limited to one top-level folder. */
export async function listSubfolders(folder?: Folder): Promise<SubfolderRow[]> {
  let q = supabase.from("subfolders").select("*").order("name");
  if (folder) q = q.eq("folder", folder);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SubfolderRow[];
}

export async function createSubfolder(folder: Folder, name: string): Promise<SubfolderRow> {
  const { data, error } = await supabase
    .from("subfolders")
    .insert({ folder, name: name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as SubfolderRow;
}

export async function deleteSubfolder(id: string) {
  const { error } = await supabase.from("subfolders").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Documents in a folder. `subfolderId` null => only top-level docs,
 * a string => only that sub-folder, undefined => everything in the folder.
 */
export async function listDocuments(folder?: Folder, subfolderId?: string | null): Promise<DocRow[]> {
  let q = supabase.from("documents").select("*").order("created_at", { ascending: false });
  if (folder) q = q.eq("folder", folder);
  if (subfolderId === null) q = q.is("subfolder_id", null);
  else if (typeof subfolderId === "string") q = q.eq("subfolder_id", subfolderId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DocRow[];
}

/** Searches only persisted document rows; no local suggestions or generated results. */
export async function searchDocuments(term: string): Promise<DocRow[]> {
  const query = term.trim();
  if (!query) return [];

  const [byName, byInvoiceNumber] = await Promise.all([
    supabase.from("documents").select("*").ilike("name", `%${query}%`).order("created_at", { ascending: false }),
    supabase.from("documents").select("*").ilike("invoice_number", `%${query}%`).order("created_at", { ascending: false }),
  ]);
  if (byName.error) throw byName.error;
  if (byInvoiceNumber.error) throw byInvoiceNumber.error;

  const unique = new Map<string, DocRow>();
  for (const row of [...(byName.data ?? []), ...(byInvoiceNumber.data ?? [])]) {
    unique.set(row.id, row as DocRow);
  }
  return [...unique.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
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

export type PaymentStatus = "paid" | "unpaid" | "overdue";

/** Client-side status: unpaid invoices past their due date read as overdue. */
export function effectivePaymentStatus(doc: DocRow): PaymentStatus {
  const s = (doc.payment_status ?? "unpaid") as PaymentStatus;
  if (s === "paid") return "paid";
  const today = new Date().toISOString().slice(0, 10);
  if (doc.due_date && doc.due_date < today) return "overdue";
  return "unpaid";
}

/** Numeric grand total for a document, from its table or its receivable ledger entry. */
export async function invoiceAmount(doc: DocRow): Promise<number> {
  const raw = invoiceTotal(doc).replace(/[^0-9.]/g, "");
  const n = parseFloat(raw);
  if (!isNaN(n) && n > 0) return n;
  const { data } = await supabase
    .from("ledger_entries" as any)
    .select("amount,account")
    .eq("document_id", doc.id);
  const rec = (data ?? []).find((r: any) => r.account === "Accounts Receivable");
  return rec ? Number((rec as any).amount) : 0;
}

/** Mark an invoice paid and record the cash receipt in the ledger. */
export async function markInvoicePaid(doc: DocRow): Promise<number> {
  const amount = await invoiceAmount(doc);
  const { error } = await supabase
    .from("documents")
    .update({ payment_status: "paid", updated_at: new Date().toISOString() } as any)
    .eq("id", doc.id);
  if (error) throw error;
  if (amount > 0) {
    const entry_date = new Date().toISOString().slice(0, 10);
    const description = `Payment received · Invoice ${doc.invoice_number || doc.name}`;
    await supabase.from("ledger_entries" as any).delete().eq("description", description);
    await supabase.from("ledger_entries" as any).insert([
      { entry_date, account: "Cash/Bank", entry_type: "debit", amount, description, document_id: doc.id },
      { entry_date, account: "Accounts Receivable", entry_type: "credit", amount, description, document_id: doc.id },
    ]);
  }
  return amount;
}