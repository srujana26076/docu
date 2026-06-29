import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Save, Download, Trash2, Plus, ChevronLeft, ChevronRight, Type, X, Bold, Italic,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { downloadPdfBytes, type DocRow, type Folder, folderMeta, deleteDocument } from "@/lib/documents";

// pdfjs is loaded dynamically (browser only)
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

interface Overlay {
  id: string;
  page: number; // 1-based
  x: number; // pdf points, top-left
  y: number;
  text: string;
  fontSize: number;
  color: string; // hex
  whiteBg: boolean;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

const RENDER_SCALE = 1.5;
const PREVIEW_SCALE = 0.7;

const FONT_FAMILIES = [
  "Inter",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Trebuchet MS",
  "Verdana",
  "Tahoma",
  "Playfair Display",
  "Roboto",
  "Open Sans",
] as const;

const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

function pdfFontFor(family: string, bold: boolean, italic: boolean) {
  const f = family.toLowerCase();
  if (f.includes("times") || f.includes("georgia") || f.includes("playfair")) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (f.includes("courier")) {
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

function hexToRgb(hex: string) {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export function PdfEditor({ doc }: { doc: DocRow }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<{ wPt: number; hPt: number } | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(doc.name);
  const [folder, setFolder] = useState<Folder>(doc.folder);
  const [saving, setSaving] = useState(false);

  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Load PDF bytes
  useEffect(() => {
    let cancelled = false;
    downloadPdfBytes(doc.storage_path).then(async (buf) => {
      if (cancelled) return;
      setBytes(buf);
      const lib = await getPdfJs();
      const loadingTask = lib.getDocument({ data: new Uint8Array(buf.slice(0)) });
      const pdf = await loadingTask.promise;
      if (cancelled) return;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
    }).catch((e) => toast.error(e?.message ?? "Failed to load PDF"));
    return () => { cancelled = true; };
  }, [doc.storage_path]);

  // Render current page to both canvases when page/pdf change
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      const p = await pdfDoc.getPage(page);
      const vp = p.getViewport({ scale: 1 });
      if (cancelled) return;
      setPageSize({ wPt: vp.width, hPt: vp.height });

      // Editor canvas
      const edit = editCanvasRef.current;
      if (edit) {
        const v = p.getViewport({ scale: RENDER_SCALE });
        edit.width = v.width;
        edit.height = v.height;
        const ctx = edit.getContext("2d")!;
        await p.render({ canvasContext: ctx, viewport: v }).promise;
      }
      // Preview canvas
      const prev = previewCanvasRef.current;
      if (prev) {
        const v = p.getViewport({ scale: PREVIEW_SCALE });
        prev.width = v.width;
        prev.height = v.height;
        const ctx = prev.getContext("2d")!;
        await p.render({ canvasContext: ctx, viewport: v }).promise;
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, page]);

  const pageOverlays = useMemo(() => overlays.filter((o) => o.page === page), [overlays, page]);

  const updateOverlay = useCallback((id: string, patch: Partial<Overlay>) => {
    setOverlays((arr) => arr.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);
  const removeOverlay = (id: string) => {
    setOverlays((arr) => arr.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // Click on editor canvas adds a new text box (when click on empty area)
  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).dataset.overlay) return;
    if (!pageSize) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const o: Overlay = {
      id: uid(),
      page,
      x: xPx / RENDER_SCALE,
      y: yPx / RENDER_SCALE,
      text: "New text",
      fontSize: 12,
      color: "#111111",
      whiteBg: true,
      fontFamily: "Inter",
      bold: false,
      italic: false,
    };
    setOverlays((arr) => [...arr, o]);
    setSelectedId(o.id);
  }

  // Drag overlay
  function startDrag(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSelectedId(id);
    const startX = e.clientX, startY = e.clientY;
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    const origX = o.x, origY = o.y;
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / RENDER_SCALE;
      const dy = (ev.clientY - startY) / RENDER_SCALE;
      updateOverlay(id, { x: origX + dx, y: origY + dy });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Bake overlays into a new PDF and return bytes
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
    for (const o of overlays) {
      const p = pages[o.page - 1];
      if (!p) continue;
      const pageHeight = p.getHeight();
      const c = hexToRgb(o.color);
      const font = await getFont(o.fontFamily ?? "Inter", !!o.bold, !!o.italic);
      const textWidth = font.widthOfTextAtSize(o.text, o.fontSize);
      const yBaseline = pageHeight - o.y - o.fontSize;
      if (o.whiteBg) {
        p.drawRectangle({
          x: o.x - 1,
          y: yBaseline - 2,
          width: textWidth + 2,
          height: o.fontSize + 4,
          color: rgb(1, 1, 1),
        });
      }
      p.drawText(o.text, { x: o.x, y: yBaseline, size: o.fontSize, font, color: rgb(c.r, c.g, c.b) });
    }
    return await out.save();
  }

  async function handleDownload() {
    try {
      const u8 = await bakePdf();
      const blob = new Blob([u8 as any], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (name || "document") + ".pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch (e: any) { toast.error(e?.message ?? "Download failed"); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const u8 = await bakePdf();
      const safe = (name || "document").replace(/[^\w.\- ]+/g, "_").trim();
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.pdf`;
      const blob = new Blob([u8 as any], { type: "application/pdf" });
      const { error: upErr } = await supabase.storage.from("documents").upload(path, blob, { contentType: "application/pdf" });
      if (upErr) throw upErr;
      const { error } = await supabase.from("documents").insert({
        name: safe.replace(/\.pdf$/i, ""),
        folder,
        storage_path: path,
        size_bytes: u8.byteLength,
        is_default: false,
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

  const selected = overlays.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-72" placeholder="File name" />
        <Select value={folder} onValueChange={(v) => setFolder(v as Folder)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="invoice">Invoices</SelectItem>
            <SelectItem value="quotation">Quotations</SelectItem>
            <SelectItem value="offer_letter">Offer Letters</SelectItem>
            <SelectItem value="template">Templates</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={handleDownload}><Download className="h-4 w-4 mr-2" />Download</Button>
          <Button onClick={handleSave} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save to folder"}</Button>
          <Button variant="outline" onClick={handleDelete} disabled={doc.is_default} title={doc.is_default ? "Default files can't be deleted" : "Delete"}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: edit left, live preview right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] min-h-0">
        {/* Editor */}
        <div className="flex flex-col min-w-0 border-r border-border bg-muted/30">
          <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Edit panel</span>
            <div className="ml-auto flex items-center gap-2 text-sm">
              <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="tabular-nums">Page {page} / {numPages || "…"}</span>
              <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <div className="inline-block relative shadow-lg bg-white mx-auto"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}>
              <canvas ref={editCanvasRef} className="block" />
              <div className="absolute inset-0 cursor-crosshair" onClick={handleCanvasClick}>
                {pageOverlays.map((o) => (
                  <OverlayBox
                    key={o.id}
                    overlay={o}
                    scale={RENDER_SCALE}
                    selected={o.id === selectedId}
                    onSelect={() => setSelectedId(o.id)}
                    onChangeText={(t) => updateOverlay(o.id, { text: t })}
                    onDragStart={(e) => startDrag(e, o.id)}
                    onRemove={() => removeOverlay(o.id)}
                  />
                ))}
              </div>
            </div>
          </div>
          {/* Properties */}
          {selected && (
            <div className="border-t border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
              <Type className="h-4 w-4 text-muted-foreground" />
              <Input className="w-64" value={selected.text} onChange={(e) => updateOverlay(selected.id, { text: e.target.value })} />
              <Button type="button" size="sm" variant={selected.bold ? "default" : "outline"}
                onClick={() => updateOverlay(selected.id, { bold: !selected.bold })} aria-label="Bold">
                <Bold className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="sm" variant={selected.italic ? "default" : "outline"}
                onClick={() => updateOverlay(selected.id, { italic: !selected.italic })} aria-label="Italic">
                <Italic className="h-3.5 w-3.5" />
              </Button>
              <label className="flex items-center gap-1.5">Font
                <select
                  value={selected.fontFamily}
                  onChange={(e) => updateOverlay(selected.id, { fontFamily: e.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  style={{ fontFamily: selected.fontFamily }}
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">Size
                <Input type="number" min={6} max={96} className="w-20" value={selected.fontSize}
                  onChange={(e) => updateOverlay(selected.id, { fontSize: Math.max(6, Math.min(96, Number(e.target.value) || 12)) })} />
                <select
                  value={FONT_SIZE_PRESETS.includes(selected.fontSize) ? String(selected.fontSize) : ""}
                  onChange={(e) => updateOverlay(selected.id, { fontSize: Number(e.target.value) })}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="" disabled>Preset</option>
                  {FONT_SIZE_PRESETS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">Color
                <input type="color" value={selected.color} onChange={(e) => updateOverlay(selected.id, { color: e.target.value })}
                  className="h-8 w-10 rounded border border-border" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={selected.whiteBg} onChange={(e) => updateOverlay(selected.id, { whiteBg: e.target.checked })} />
                White background (cover existing text)
              </label>
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => removeOverlay(selected.id)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />Remove
              </Button>
            </div>
          )}
          {!selected && (
            <div className="border-t border-border bg-card px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
              <Plus className="h-3.5 w-3.5" /> Click anywhere on the page to add text. Drag to position. Double-click to edit.
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="flex flex-col min-w-0 bg-muted/10">
          <div className="px-4 py-2 border-b border-border bg-card">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Live preview</span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="inline-block relative shadow bg-white mx-auto">
              <canvas ref={previewCanvasRef} className="block" />
              <div className="absolute inset-0 pointer-events-none">
                {pageOverlays.map((o) => (
                  <div key={o.id}
                    style={{
                      position: "absolute",
                      left: o.x * PREVIEW_SCALE,
                      top: o.y * PREVIEW_SCALE,
                      fontSize: o.fontSize * PREVIEW_SCALE,
                      color: o.color,
                      background: o.whiteBg ? "white" : "transparent",
                      padding: o.whiteBg ? "0 2px" : 0,
                      lineHeight: 1.1,
                      fontFamily: `${o.fontFamily ?? "Inter"}, Helvetica, Arial, sans-serif`,
                      fontWeight: o.bold ? 700 : 400,
                      fontStyle: o.italic ? "italic" : "normal",
                      whiteSpace: "pre",
                    }}>
                    {o.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverlayBox({
  overlay: o, scale, selected, onSelect, onChangeText, onDragStart, onRemove,
}: {
  overlay: Overlay; scale: number; selected: boolean;
  onSelect: () => void; onChangeText: (t: string) => void;
  onDragStart: (e: React.MouseEvent) => void; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      data-overlay
      onMouseDown={(e) => { onSelect(); if (!editing) onDragStart(e); }}
      onDoubleClick={() => setEditing(true)}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: o.x * scale,
        top: o.y * scale,
        fontSize: o.fontSize * scale,
        color: o.color,
        background: o.whiteBg ? "white" : "transparent",
        padding: o.whiteBg ? "0 2px" : 0,
        lineHeight: 1.1,
        fontFamily: `${o.fontFamily ?? "Inter"}, Helvetica, Arial, sans-serif`,
        fontWeight: o.bold ? 700 : 400,
        fontStyle: o.italic ? "italic" : "normal",
        whiteSpace: "pre",
        cursor: editing ? "text" : "move",
        outline: selected ? "1.5px dashed var(--ring)" : "1px dashed rgba(0,0,0,0.15)",
        outlineOffset: 1,
        minWidth: 8,
        minHeight: o.fontSize * scale,
      }}
    >
      {editing ? (
        <input
          autoFocus
          value={o.text}
          onChange={(e) => onChangeText(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(false); } }}
          style={{
            background: "transparent", border: "none", outline: "none",
            fontSize: "inherit", color: "inherit", fontFamily: "inherit",
            padding: 0, width: `${Math.max(8, o.text.length + 1)}ch`,
          }}
        />
      ) : (
        <span>{o.text || " "}</span>
      )}
      {selected && !editing && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: "absolute", top: -10, right: -10, width: 18, height: 18,
            borderRadius: 9, background: "var(--destructive)", color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "none", cursor: "pointer",
          }}
          aria-label="Remove">
          <X size={12} />
        </button>
      )}
    </div>
  );
}