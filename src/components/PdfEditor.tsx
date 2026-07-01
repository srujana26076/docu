import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Save, Download, Trash2, Bold, Italic, Type, Undo2, ZoomIn, ZoomOut, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { downloadPdfBytes, type DocRow, type Folder, folderMeta, deleteDocument } from "@/lib/documents";

// ---- pdfjs lazy loader ----------------------------------------------------
type PdfJsLib = typeof import("pdfjs-dist");
let pdfjsLib: PdfJsLib | null = null;
async function getPdfJs(): Promise<PdfJsLib> {
  if (pdfjsLib) return pdfjsLib;
  const mod = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsLib = mod;
  return mod;
}

// ---- types ----------------------------------------------------------------
interface FieldStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}
interface Field extends FieldStyle {
  id: string;
  page: number;       // 1-based
  index: number;      // index within page, for FIELD N labeling
  original: string;
  text: string;       // edited value
  x: number;          // pdf points, baseline (origin bottom-left)
  y: number;
  width: number;      // original width in pdf points
  origFontSize: number;
  autoKind?: "date" | "invoice";
}

const FONT_FAMILIES = [
  "Inter", "Arial", "Helvetica", "Times New Roman", "Georgia",
  "Courier New", "Trebuchet MS", "Verdana", "Tahoma", "Playfair Display",
  "Roboto", "Open Sans",
];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];
const COLOR_SWATCHES = ["#0b1320", "#1e3a8a", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed"];

const DEFAULT_STYLE: FieldStyle = {
  fontFamily: "Arial", fontSize: 12, color: "#0b1320", bold: false, italic: false,
};

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
function formatInvoiceNumber(prefix: string, n: number): string {
  const d = new Date();
  const mmdd = String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  return `${prefix}-${mmdd}-${String(n).padStart(4, "0")}`;
}

function hexToRgb(hex: string) {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function pdfFontFor(family: string, bold: boolean, italic: boolean) {
  const f = family.toLowerCase();
  if (f.includes("times") || f.includes("georgia") || f.includes("playfair") || f.includes("serif")) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (f.includes("courier") || f.includes("mono")) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

// ---------------------------------------------------------------------------
export function PdfEditor({ doc }: { doc: DocRow }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageSizes, setPageSizes] = useState<{ wPt: number; hPt: number }[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [history, setHistory] = useState<Field[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [name, setName] = useState(doc.name);
  const [folder, setFolder] = useState<Folder>(doc.folder);
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const [saving, setSaving] = useState(false);

  const previewWrapRef = useRef<HTMLDivElement>(null);
  const pageCanvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(doc.invoice_number ?? null);
  const [invoiceDate, setInvoiceDate] = useState<string>(doc.invoice_date ?? formatToday());
  // Live-track today's date while editing
  useEffect(() => {
    const id = setInterval(() => {
      const t = formatToday();
      setInvoiceDate((prev) => (prev === t ? prev : t));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Peek next invoice number (without allocating) if this doc doesn't already have one
  useEffect(() => {
    if (doc.folder !== "invoice") return;
    if (invoiceNumber) return;
    (async () => {
      const { data } = await supabase.from("invoice_counter").select("last_number, prefix").eq("id", 1).maybeSingle();
      if (!data) return;
      setInvoiceNumber(formatInvoiceNumber(data.prefix ?? "IVHPS", (data.last_number ?? 5032) + 1));
    })();
  }, [doc.folder, invoiceNumber]);

  // Sync auto-injected Date / Invoice No. value fields with live values
  useEffect(() => {
    if (!fields.length) return;
    setFields((arr) => {
      let changed = false;
      const next = arr.map((f) => {
        if (f.autoKind === "date" && f.text !== invoiceDate) { changed = true; return { ...f, text: invoiceDate }; }
        if (f.autoKind === "invoice" && invoiceNumber && f.text !== invoiceNumber) { changed = true; return { ...f, text: invoiceNumber }; }
        return f;
      });
      return changed ? next : arr;
    });
  }, [invoiceDate, invoiceNumber, fields.length]);

  // Load PDF & extract text content per page as fields
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await downloadPdfBytes(doc.storage_path);
        if (cancelled) return;
        setBytes(buf);
        const lib = await getPdfJs();
        const pdf = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        if (cancelled) return;
        setPdfDoc(pdf);

        const sizes: { wPt: number; hPt: number }[] = [];
        const collected: Field[] = [];
        for (let pn = 1; pn <= pdf.numPages; pn++) {
          const p = await pdf.getPage(pn);
          const vp = p.getViewport({ scale: 1 });
          sizes.push({ wPt: vp.width, hPt: vp.height });
          const tc = await p.getTextContent();
          let idx = 0;
          for (const itAny of tc.items as any[]) {
            const s: string = (itAny.str ?? "").toString();
            if (!s.trim()) continue;
            const tr: number[] = itAny.transform;
            const fontSize = Math.hypot(tr[2], tr[3]) || itAny.height || 10;
            const width = itAny.width ?? 0;
            collected.push({
              id: `${pn}-${idx}`,
              page: pn,
              index: idx + 1,
              original: s,
              text: s,
              x: tr[4],
              y: tr[5],
              width,
              origFontSize: fontSize,
              ...DEFAULT_STYLE,
              fontSize: Math.round(fontSize),
            });
            idx++;

            // Auto-inject an editable value field right after "Date:" / "Invoice No.:" labels
            const norm = s.trim().toLowerCase().replace(/\s+/g, " ");
            const isDate = /^date\s*:?$/.test(norm);
            const isInv = /^(invoice|inovice)\s*no\.?\s*:?$/.test(norm);
            if (isDate || isInv) {
              collected.push({
                id: `${pn}-${idx}-val`,
                page: pn,
                index: idx + 1,
                original: "",
                text: "",
                x: tr[4] + width + fontSize * 0.4,
                y: tr[5],
                width: 0,
                origFontSize: fontSize,
                ...DEFAULT_STYLE,
                fontSize: Math.round(fontSize),
                bold: true,
                autoKind: isDate ? "date" : "invoice",
              });
              idx++;
            }
          }
        }
        if (cancelled) return;
        // Re-number index sequentially per page (idx skipped whitespace earlier so already sequential)
        setPageSizes(sizes);
        setFields(collected);
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to load PDF");
      }
    })();
    return () => { cancelled = true; };
  }, [doc.storage_path]);

  // Render each page canvas when pdf loads or zoom changes
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      const scale = 1.4 * zoom;
      for (let pn = 1; pn <= pdfDoc.numPages; pn++) {
        const canvas = pageCanvasRefs.current[pn];
        if (!canvas) continue;
        const p = await pdfDoc.getPage(pn);
        const vp = p.getViewport({ scale });
        if (cancelled) return;
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d")!;
        await p.render({ canvas, canvasContext: ctx, viewport: vp } as any).promise;
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, zoom, pageSizes]);

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-49), fields]);
  }, [fields]);

  const updateField = useCallback((id: string, patch: Partial<Field>, snapshot = true) => {
    if (snapshot) setHistory((h) => [...h.slice(-49), fields]);
    setFields((arr) => arr.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, [fields]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFields(prev);
      return h.slice(0, -1);
    });
  }, []);

  const resetEdits = useCallback(() => {
    if (!confirm("Reset all edits to original?")) return;
    pushHistory();
    setFields((arr) => arr.map((f) => ({ ...f, text: f.original, ...DEFAULT_STYLE, fontSize: Math.round(f.origFontSize) })));
  }, [pushHistory]);

  const selected = fields.find((f) => f.id === selectedId) ?? null;

  const editedCount = useMemo(
    () => fields.filter((f) => f.text !== f.original).length,
    [fields],
  );

  // Bake edited fields into PDF
  async function bakePdf(): Promise<Uint8Array> {
    if (!bytes) throw new Error("PDF not loaded");
    const out = await PDFDocument.load(bytes.slice(0));
    const fontCache = new Map<string, any>();
    async function getFont(family: string, bold: boolean, italic: boolean) {
      const std = pdfFontFor(family, bold, italic);
      if (!fontCache.has(std)) fontCache.set(std, await out.embedFont(std));
      return fontCache.get(std);
    }
    const pages = out.getPages();
    for (const f of fields) {
      if (f.text === f.original) continue;
      const p = pages[f.page - 1];
      if (!p) continue;
      const font = await getFont(f.fontFamily, f.bold, f.italic);
      const c = hexToRgb(f.color);
      // Cover original glyph box (ascent + descent + side bleed)
      const newW = font.widthOfTextAtSize(f.text, f.fontSize);
      const coverW = Math.max(f.width, newW) + f.origFontSize * 0.4;
      const coverH = f.origFontSize * 1.45;
      p.drawRectangle({
        x: f.x - f.origFontSize * 0.15,
        y: f.y - f.origFontSize * 0.3,
        width: coverW,
        height: coverH,
        color: rgb(1, 1, 1),
      });
      p.drawText(f.text, {
        x: f.x, y: f.y, size: f.fontSize, font, color: rgb(c.r, c.g, c.b),
      });
    }
    return await out.save();
  }

  async function handleDownload() {
    try {
      const u8 = await bakePdf();
      const blob = new Blob([u8 as any], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = (name || "document") + ".pdf"; a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch (e: any) { toast.error(e?.message ?? "Download failed"); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Allocate a real invoice number on save (only for invoice folder, first save)
      let finalInvoice = invoiceNumber;
      let fieldsForBake = fields;
      if (folder === "invoice" && !doc.invoice_number) {
        const { data: allocated, error: allocErr } = await supabase.rpc("allocate_invoice_number");
        if (!allocErr && allocated) {
          finalInvoice = allocated as unknown as string;
          setInvoiceNumber(finalInvoice);
          fieldsForBake = fields.map((f) => f.autoKind === "invoice" ? { ...f, text: finalInvoice! } : f);
          setFields(fieldsForBake);
        }
      }
      const u8 = await bakeFrom(fieldsForBake);
      const safe = (name || "document").replace(/[^\w.\- ]+/g, "_").trim();
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.pdf`;
      const blob = new Blob([u8 as any], { type: "application/pdf" });
      const { error: upErr } = await supabase.storage.from("documents").upload(path, blob, { contentType: "application/pdf" });
      if (upErr) throw upErr;
      const { error } = await supabase.from("documents").insert({
        name: safe.replace(/\.pdf$/i, ""), folder, storage_path: path,
        size_bytes: u8.byteLength, is_default: false,
        invoice_number: folder === "invoice" ? finalInvoice : null,
        invoice_date: folder === "invoice" ? invoiceDate : null,
      });
      if (error) throw error;
      toast.success(`Saved to ${folderMeta[folder].title}`);
      qc.invalidateQueries({ queryKey: ["folder", folder] });
      qc.invalidateQueries({ queryKey: ["recent"] });
      qc.invalidateQueries({ queryKey: ["recent-all"] });
      navigate({ to: `/${folderMeta[folder].slug}` as any });
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (doc.is_default) return toast.error("Default files can't be deleted");
    if (!confirm(`Delete "${doc.name}"?`)) return;
    try {
      await deleteDocument(doc);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["folder", doc.folder] });
      qc.invalidateQueries({ queryKey: ["recent"] });
      navigate({ to: `/${folderMeta[doc.folder].slug}` as any });
    } catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  }

  const pageScale = 1.4 * zoom;
  const pageNumbers = pageSizes.map((_, i) => i + 1);
  const fieldsByPage = useMemo(() => {
    const m = new Map<number, Field[]>();
    for (const f of fields) {
      if (!m.has(f.page)) m.set(f.page, []);
      m.get(f.page)!.push(f);
    }
    return m;
  }, [fields]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top action bar: filename, folder, save/download/delete */}
      <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-2 flex-wrap">
        <Select value={folder} onValueChange={(v) => setFolder(v as Folder)}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="invoice">Invoices</SelectItem>
            <SelectItem value="quotation">Quotations</SelectItem>
            <SelectItem value="offer_letter">Offer Letters</SelectItem>
            <SelectItem value="template">Templates</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />Download
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={doc.is_default}
            title={doc.is_default ? "Default files can't be deleted" : "Delete"}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: left fields panel, right live preview */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[360px_1fr] min-h-0">
        {/* LEFT — Fields panel */}
        <aside className="border-r border-border bg-card flex flex-col min-h-0">
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground mb-2">DOCUMENT</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{pageSizes.length || "…"} page{pageSizes.length === 1 ? "" : "s"} · {fields.length} fields</span>
              <button onClick={resetEdits} className="text-primary hover:underline">Reset edits</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {pageNumbers.map((pn) => {
              const list = fieldsByPage.get(pn) ?? [];
              return (
                <div key={pn}>
                  <div className="sticky top-0 z-10 px-4 py-2 bg-muted/60 border-b border-border text-xs font-medium text-muted-foreground">
                    Page {pn} · {list.length} fields
                  </div>
                  {list.map((f, i) => {
                    const edited = f.text !== f.original;
                    const isSel = f.id === selectedId;
                    return (
                      <div key={f.id}
                        onMouseDown={() => setSelectedId(f.id)}
                        className={`px-4 py-3 border-b border-border cursor-text ${isSel ? "bg-primary/5" : ""}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground">FIELD {i + 1}</span>
                          {edited && <span className="text-[10px] font-semibold tracking-[0.14em] text-primary">EDITED</span>}
                        </div>
                        <Input
                          value={f.text}
                          onFocus={() => setSelectedId(f.id)}
                          onChange={(e) => updateField(f.id, { text: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>

        {/* RIGHT — Formatting toolbar + preview */}
        <section className="flex flex-col min-h-0">
          {/* Formatting toolbar */}
          <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-3 flex-wrap text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Type className="h-4 w-4" /><span>Text</span>
            </div>
            <div className="h-5 w-px bg-border" />
            <Button type="button" size="icon" variant={selected?.bold ? "default" : "outline"}
              className="h-8 w-8" disabled={!selected}
              onClick={() => selected && updateField(selected.id, { bold: !selected.bold })}>
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="icon" variant={selected?.italic ? "default" : "outline"}
              className="h-8 w-8" disabled={!selected}
              onClick={() => selected && updateField(selected.id, { italic: !selected.italic })}>
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <select
              disabled={!selected}
              value={selected?.fontFamily ?? "Arial"}
              onChange={(e) => selected && updateField(selected.id, { fontFamily: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
              style={{ fontFamily: selected?.fontFamily ?? "Arial" }}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <Input type="number" min={6} max={96} disabled={!selected}
                value={selected?.fontSize ?? 12}
                onChange={(e) => selected && updateField(selected.id, { fontSize: Math.max(6, Math.min(96, Number(e.target.value) || 12)) })}
                className="h-8 w-16" />
              <select
                disabled={!selected}
                value={selected && FONT_SIZES.includes(selected.fontSize) ? String(selected.fontSize) : ""}
                onChange={(e) => selected && updateField(selected.id, { fontSize: Number(e.target.value) })}
                className="h-8 rounded-md border border-input bg-background px-1 text-sm"
                aria-label="Preset size"
              >
                <option value="" disabled>—</option>
                {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <input type="color" disabled={!selected}
              value={selected?.color ?? "#0b1320"}
              onChange={(e) => selected && updateField(selected.id, { color: e.target.value })}
              className="h-8 w-8 rounded border border-border p-0" />
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              {COLOR_SWATCHES.map((c) => (
                <button key={c}
                  disabled={!selected}
                  onClick={() => selected && updateField(selected.id, { color: c })}
                  className="h-5 w-5 rounded-full border-2 border-white shadow ring-1 ring-border disabled:opacity-50"
                  style={{ background: c, outline: selected?.color === c ? "2px solid hsl(var(--ring))" : "none", outlineOffset: 2 }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={undo} disabled={!history.length}>
              <Undo2 className="h-4 w-4 mr-1.5" />Undo
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="tabular-nums text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Reset zoom" onClick={() => setZoom(1)}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Preview */}
          <div ref={previewWrapRef} className="flex-1 overflow-auto bg-muted/30 p-6">
            <div className="flex flex-col items-center gap-6">
              {pageNumbers.map((pn) => {
                const size = pageSizes[pn - 1];
                if (!size) return null;
                const list = fieldsByPage.get(pn) ?? [];
                const wPx = size.wPt * pageScale;
                const hPx = size.hPt * pageScale;
                return (
                  <div key={pn} className="relative shadow-lg bg-white" style={{ width: wPx, height: hPx }}>
                    <canvas
                      ref={(el) => { pageCanvasRefs.current[pn] = el; }}
                      className="block"
                      style={{ width: wPx, height: hPx }}
                    />
                    {/* Edited text overlays */}
                    <div className="absolute inset-0">
                      {list.map((f) => {
                        const edited = f.text !== f.original;
                        if (!edited && f.id !== selectedId) return null;
                        // White mask covering the original glyph box
                        const maskLeft = (f.x - f.origFontSize * 0.15) * pageScale;
                        const maskTop = (size.hPt - f.y - f.origFontSize * 1.15) * pageScale;
                        const maskW = (Math.max(f.width, 4) + f.origFontSize * 0.4) * pageScale;
                        const maskH = f.origFontSize * 1.45 * pageScale;
                        // New text drawn at the original baseline
                        const textLeft = f.x * pageScale;
                        const textTop = (size.hPt - f.y - f.origFontSize) * pageScale;
                        return (
                          <div key={f.id}
                            onMouseDown={(e) => { e.stopPropagation(); setSelectedId(f.id); }}
                            style={{ position: "absolute", inset: 0, cursor: "text" }}>
                            {edited && (
                              <div style={{
                                position: "absolute",
                                left: maskLeft, top: maskTop,
                                width: maskW, height: maskH,
                                background: "white",
                              }} />
                            )}
                            <div style={{
                              position: "absolute",
                              left: textLeft, top: textTop,
                              color: f.color,
                              fontFamily: `${f.fontFamily}, Helvetica, Arial, sans-serif`,
                              fontSize: f.fontSize * pageScale,
                              fontWeight: f.bold ? 700 : 400,
                              fontStyle: f.italic ? "italic" : "normal",
                              lineHeight: 1,
                              whiteSpace: "pre",
                              outline: f.id === selectedId ? "1.5px dashed hsl(var(--ring))" : "none",
                              outlineOffset: 1,
                            }}>
                              {edited ? f.text : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {!pdfDoc && <div className="text-sm text-muted-foreground py-20">Loading document…</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}