import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import notoRegularUrl from "@/assets/fonts/NotoSans-Regular.ttf?url";
import notoBoldUrl from "@/assets/fonts/NotoSans-Bold.ttf?url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Save, Download, Trash2, Bold, Italic, Underline, Type, Undo2, ZoomIn, ZoomOut, RotateCcw,
  Table as TableIcon, Plus, Minus, AlignLeft, AlignCenter, AlignRight,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { downloadPdfBytes, type DocRow, type Folder, folderMeta, deleteDocument } from "@/lib/documents";
import { TableOverlayView, makeTable, defaultCell, type TableData, type TableCell } from "./TableOverlay";

// ---- invoice table config -------------------------------------------------
const INVOICE_HEADERS = ["Requirements", "HSN", "Unit price", "Quantity", "Taxable amount", "GST(18%)", "Total (₹)"];
const INVOICE_COL_WIDTHS = [130, 50, 65, 55, 85, 75, 80];
const num = (s: string) => {
  const n = parseFloat((s || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => n.toFixed(2);
function rateOf(text: string) {
  const m = /([\d.]+)\s*%/.exec(text || "");
  return m ? parseFloat(m[1]) : 18;
}
/** Recompute taxable / gst / total columns for one row (cols 4,5,6). */
function recalcRow(row: TableCell[], mode: "exclusive" | "inclusive" = "exclusive"): TableCell[] {
  const r = row.slice();
  const amount = num(r[2]?.text ?? "") * num(r[3]?.text ?? "");
  const rate = rateOf(r[5]?.text ?? "");
  let taxable: number, gst: number;
  if (mode === "inclusive") {
    taxable = amount / (1 + rate / 100);
    gst = amount - taxable;
  } else {
    taxable = amount;
    gst = (taxable * rate) / 100;
  }
  if (r[4]) r[4] = { ...r[4], text: money(taxable) };
  if (r[5]) r[5] = { ...r[5], text: `${rate}% (${money(gst)})` };
  if (r[6]) r[6] = { ...r[6], text: money(taxable + gst) };
  return r;
}
function isInvoiceTable(t: TableData) {
  return t.colWidths.length === 7 && (t.cells[0]?.[0]?.text ?? "") === "Requirements";
}

// ---- grand total / words rows --------------------------------------------
const TOTAL_LABEL = "Total (Inclusive of taxes):";
const WORDS_LABEL = "Total amount in words:";
const isSummaryRow = (row: TableCell[]) => {
  const t = row?.[0]?.text ?? "";
  return t.startsWith(TOTAL_LABEL) || t.startsWith(WORDS_LABEL);
};
/** Data (line item) rows only — excludes header row and summary rows. */
function lineRowsOf(t: TableData | null) {
  if (!t) return [] as { row: TableCell[]; index: number }[];
  return t.cells
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index > 0 && !isSummaryRow(row));
}
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}
function inWords(n: number): string {
  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  if (rupees === 0 && paise === 0) return "zero rupees only";
  const parts: string[] = [];
  const push = (v: number, label: string) => { if (v) parts.push(`${twoDigits(v)} ${label}`); };
  push(Math.floor(rupees / 10000000), "crore");
  push(Math.floor((rupees / 100000) % 100), "lakh");
  push(Math.floor((rupees / 1000) % 100), "thousand");
  push(Math.floor((rupees / 100) % 10), "hundred");
  const rest = rupees % 100;
  if (rest) parts.push(twoDigits(rest));
  let s = parts.join(" ") + " rupees";
  if (paise) s += ` and ${twoDigits(paise)} paise`;
  return s + " only";
}
/** Ensure the invoice table ends with a live Grand Total row + amount-in-words row. */
function withTotalRows(t: TableData): TableData {
  const lines = lineRowsOf(t);
  const total = lines.reduce((a, { row }) => a + num(row[6]?.text ?? ""), 0);
  const cells = [t.cells[0], ...lines.map(({ row }) => row)];
  const rowHeights = [t.rowHeights[0] ?? 24, ...lines.map(({ index }) => t.rowHeights[index] ?? 24)];
  const blank = (text = "") => ({ ...defaultCell(), text });
  const totalRow = Array.from({ length: 7 }, (_, c) =>
    c === 0
      ? { ...defaultCell(), text: TOTAL_LABEL, bold: true }
      : c === 6
        ? { ...defaultCell(), text: `₹${money(total)}`, bold: true, hAlign: "right" as const }
        : blank(),
  );
  const wordsRow = Array.from({ length: 7 }, (_, c) =>
    c === 0
      ? { ...defaultCell(), text: `${WORDS_LABEL} ${inWords(total)}`, italic: true, colSpan: 7 }
      : blank(),
  );
  const h = t.rowHeights[1] ?? 24;
  return { ...t, cells: [...cells, totalRow, wordsRow], rowHeights: [...rowHeights, h, h] };
}

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

  // ---- Tables state ----
  const [tables, setTables] = useState<TableData[]>(Array.isArray(doc.tables_json) ? doc.tables_json : []);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;
  const updateTable = (id: string, patch: Partial<TableData> | ((t: TableData) => TableData)) => {
    setTables((arr) => arr.map((t) => t.id === id ? (typeof patch === "function" ? patch(t) : { ...t, ...patch }) : t));
  };
  const patchCell = (patch: Partial<TableCell>) => {
    if (!selectedTable || !selectedCell) return;
    const cells = selectedTable.cells.map((row) => row.slice());
    cells[selectedCell.r][selectedCell.c] = { ...cells[selectedCell.r][selectedCell.c], ...patch };
    updateTable(selectedTable.id, { cells });
  };
  const selCell = selectedTable && selectedCell ? selectedTable.cells[selectedCell.r]?.[selectedCell.c] : null;

  function insertInvoiceTable() {
    if (!pageSizes.length) return;
    const size = pageSizes[0];
    // Place below existing page-1 content so it never overlaps the title/header.
    const pageFields = fields.filter((f) => f.page === 1);
    const lowestY = pageFields.length ? Math.min(...pageFields.map((f) => f.y)) : size.hPt * 0.35;
    const existing = tables.filter((t) => t.page === 1);
    const belowTables = existing.length
      ? Math.max(...existing.map((t) => t.y + t.rowHeights.reduce((a, b) => a + b, 0))) + 20
      : 0;
    const top = Math.min(Math.max(size.hPt - lowestY + 24, belowTables), size.hPt - 140);
    const t = makeTable(1, 5, 7, 30, top);
    t.colWidths = INVOICE_COL_WIDTHS.slice();
    t.cells = t.cells.map((row, r) =>
      row.map((cell, c) => (r === 0 ? { ...cell, text: INVOICE_HEADERS[c], bold: true, bg: "#f1f5f9", hAlign: "center" as const } : cell)),
    );
    // seed GST rate on data rows
    t.cells = t.cells.map((row, r) => (r === 0 ? row : recalcRow(row.map((cell, c) => (c === 5 ? { ...cell, text: "18%" } : cell)))));
    setTables((arr) => [...arr, withTotalRows(t)]);
    setSelectedTableId(t.id);
    setSelectedCell({ r: 1, c: 0 });
    setInsertOpen(false);
    toast.success("Inserted invoice table");
  }

  // ---- Left-panel GST calculation, driven directly by the invoice table ----
  const invoiceTable = tables.find(isInvoiceTable) ?? null;
  const [gstMode, setGstMode] = useState<"exclusive" | "inclusive">("exclusive");
  const [taxTypes, setTaxTypes] = useState<Record<number, string>>({});
  const invoiceLineRows = lineRowsOf(invoiceTable);
  const gstTotals = invoiceLineRows.reduce(
    (acc, { row }) => {
      const taxable = num(row[4]?.text ?? "");
      const total = num(row[6]?.text ?? "");
      return { taxable: acc.taxable + taxable, gst: acc.gst + (total - taxable), total: acc.total + total };
    },
    { taxable: 0, gst: 0, total: 0 },
  );
  const setLineCell = (rowIdx: number, colIdx: number, value: string) => {
    if (!invoiceTable) return;
    updateTable(invoiceTable.id, (t) => {
      const cells = t.cells.map((row) => row.slice());
      cells[rowIdx][colIdx] = { ...cells[rowIdx][colIdx], text: value };
      cells[rowIdx] = recalcRow(cells[rowIdx], gstMode);
      return withTotalRows({ ...t, cells });
    });
  };
  const changeGstMode = (m: "exclusive" | "inclusive") => {
    setGstMode(m);
    if (!invoiceTable) return;
    updateTable(invoiceTable.id, (t) =>
      withTotalRows({
        ...t,
        cells: t.cells.map((row, r) => (r === 0 || isSummaryRow(row) ? row : recalcRow(row.slice(), m))),
      }),
    );
  };
  const addLineItem = () => {
    if (!invoiceTable) return;
    updateTable(invoiceTable.id, (t) => {
      const row = Array.from({ length: 7 }, defaultCell);
      row[5] = { ...row[5], text: "18%" };
      const lines = lineRowsOf(t);
      const cells = [t.cells[0], ...lines.map((l) => l.row), recalcRow(row, gstMode)];
      const rowHeights = [t.rowHeights[0] ?? 24, ...lines.map((l) => t.rowHeights[l.index] ?? 24), t.rowHeights[1] ?? 24];
      return withTotalRows({ ...t, cells, rowHeights });
    });
  };
  const removeLineItem = (rowIdx: number) => {
    if (!invoiceTable || lineRowsOf(invoiceTable).length <= 1) return;
    updateTable(invoiceTable.id, (t) =>
      withTotalRows({
        ...t,
        cells: t.cells.filter((_, i) => i !== rowIdx),
        rowHeights: t.rowHeights.filter((_, i) => i !== rowIdx),
      }),
    );
  };
  function addRow(after = true) {
    if (!selectedTable) return;
    const idx = after ? (selectedCell?.r ?? selectedTable.cells.length - 1) + 1 : (selectedCell?.r ?? 0);
    const cols = selectedTable.colWidths.length;
    const newRow = Array.from({ length: cols }, defaultCell);
    const cells = selectedTable.cells.slice(); cells.splice(idx, 0, newRow);
    const rowHeights = selectedTable.rowHeights.slice(); rowHeights.splice(idx, 0, rowHeights[0] ?? 24);
    updateTable(selectedTable.id, { cells, rowHeights });
  }
  function delRow() {
    if (!selectedTable || selectedCell == null) return;
    if (selectedTable.cells.length <= 1) return;
    const idx = selectedCell.r;
    const cells = selectedTable.cells.filter((_, i) => i !== idx);
    const rowHeights = selectedTable.rowHeights.filter((_, i) => i !== idx);
    updateTable(selectedTable.id, { cells, rowHeights });
    setSelectedCell({ r: Math.max(0, idx - 1), c: selectedCell.c });
  }
  function addCol(after = true) {
    if (!selectedTable) return;
    const idx = after ? (selectedCell?.c ?? selectedTable.colWidths.length - 1) + 1 : (selectedCell?.c ?? 0);
    const cells = selectedTable.cells.map((row) => { const r = row.slice(); r.splice(idx, 0, defaultCell()); return r; });
    const colWidths = selectedTable.colWidths.slice(); colWidths.splice(idx, 0, colWidths[0] ?? 80);
    updateTable(selectedTable.id, { cells, colWidths });
  }
  function delCol() {
    if (!selectedTable || selectedCell == null) return;
    if (selectedTable.colWidths.length <= 1) return;
    const idx = selectedCell.c;
    const cells = selectedTable.cells.map((row) => row.filter((_, i) => i !== idx));
    const colWidths = selectedTable.colWidths.filter((_, i) => i !== idx);
    updateTable(selectedTable.id, { cells, colWidths });
    setSelectedCell({ r: selectedCell.r, c: Math.max(0, idx - 1) });
  }
  function deleteTable() {
    if (!selectedTable) return;
    if (!confirm("Delete this table?")) return;
    setTables((arr) => arr.filter((t) => t.id !== selectedTable.id));
    setSelectedTableId(null); setSelectedCell(null);
  }

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
    return bakeFrom(fields);
  }
  async function bakeFrom(list: Field[]): Promise<Uint8Array> {
    if (!bytes) throw new Error("PDF not loaded");
    const out = await PDFDocument.load(bytes.slice(0));
    const fontCache = new Map<string, any>();
    async function getFont(family: string, bold: boolean, italic: boolean) {
      const std = pdfFontFor(family, bold, italic);
      if (!fontCache.has(std)) fontCache.set(std, await out.embedFont(std));
      return fontCache.get(std);
    }
    const pages = out.getPages();
    for (const f of list) {
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
    // Draw tables
    for (const t of tables) {
      const p = pages[t.page - 1];
      if (!p) continue;
      const pageH = p.getHeight();
      const totalW = t.colWidths.reduce((a, b) => a + b, 0);
      const bc = hexToRgb(t.borderColor);
      // Cell backgrounds and text
      let yTop = pageH - t.y; // top edge in pdf coords
      for (let r = 0; r < t.cells.length; r++) {
        const rh = t.rowHeights[r];
        let xLeft = t.x;
        for (let c = 0; c < t.cells[r].length; c++) {
          const cell = t.cells[r][c];
          let covered = false;
          for (let i = 0; i < c; i++) {
            const s = t.cells[r][i]?.colSpan ?? 1;
            if (s > 1 && i + s > c) { covered = true; break; }
          }
          if (covered) { xLeft += t.colWidths[c]; continue; }
          const span = Math.min(cell.colSpan ?? 1, t.cells[r].length - c);
          let cw = 0;
          for (let k = 0; k < span; k++) cw += t.colWidths[c + k] ?? 0;
          const bg = hexToRgb(cell.bg || "#ffffff");
          p.drawRectangle({ x: xLeft, y: yTop - rh, width: cw, height: rh, color: rgb(bg.r, bg.g, bg.b) });
          // text
          const font = await getFont(cell.fontFamily || "Arial", !!cell.bold, !!cell.italic);
          const size = cell.fontSize || 11;
          const tc = hexToRgb(cell.color || "#0b1320");
          const pad = cell.padding ?? 4;
          const lines = (cell.text || "").split("\n");
          const lineH = size * 1.2;
          const blockH = lines.length * lineH;
          let ty: number;
          if (cell.vAlign === "top") ty = yTop - pad - size;
          else if (cell.vAlign === "bottom") ty = yTop - rh + pad + (blockH - size);
          else ty = yTop - rh / 2 + blockH / 2 - size;
          for (const line of lines) {
            const tw = font.widthOfTextAtSize(line, size);
            let tx: number;
            if (cell.hAlign === "center") tx = xLeft + (cw - tw) / 2;
            else if (cell.hAlign === "right") tx = xLeft + cw - pad - tw;
            else tx = xLeft + pad;
            p.drawText(line, { x: tx, y: ty, size, font, color: rgb(tc.r, tc.g, tc.b) });
            if (cell.underline) {
              p.drawLine({
                start: { x: tx, y: ty - 1 }, end: { x: tx + tw, y: ty - 1 },
                thickness: Math.max(0.5, size * 0.06), color: rgb(tc.r, tc.g, tc.b),
              });
            }
            ty -= lineH;
          }
          xLeft += cw;
        }
        yTop -= rh;
      }
      // Borders (draw grid + outer)
      if (t.borderVisible) {
        const bw = t.borderWidth;
        const topY = pageH - t.y;
        // horizontal lines
        let hy = topY;
        for (let r = 0; r <= t.rowHeights.length; r++) {
          p.drawLine({ start: { x: t.x, y: hy }, end: { x: t.x + totalW, y: hy }, thickness: bw, color: rgb(bc.r, bc.g, bc.b) });
          if (r < t.rowHeights.length) hy -= t.rowHeights[r];
        }
        // vertical lines, drawn per row so merged (colSpan) cells have no inner dividers
        let ry = topY;
        for (let r = 0; r < t.rowHeights.length; r++) {
          const rh = t.rowHeights[r];
          const row = t.cells[r] ?? [];
          const hidden = new Set<number>();
          for (let i = 0; i < row.length; i++) {
            const s = row[i]?.colSpan ?? 1;
            for (let k = 1; k < s; k++) hidden.add(i + k);
          }
          let vx = t.x;
          for (let c = 0; c <= t.colWidths.length; c++) {
            if (!hidden.has(c)) {
              p.drawLine({ start: { x: vx, y: ry }, end: { x: vx, y: ry - rh }, thickness: bw, color: rgb(bc.r, bc.g, bc.b) });
            }
            if (c < t.colWidths.length) vx += t.colWidths[c];
          }
          ry -= rh;
        }
      }
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
      const { data: newDoc, error } = await supabase.from("documents").insert({
        name: safe.replace(/\.pdf$/i, ""), folder, storage_path: path,
        size_bytes: u8.byteLength, is_default: false,
        invoice_number: folder === "invoice" ? finalInvoice : null,
        invoice_date: folder === "invoice" ? invoiceDate : null,
        tables_json: tables as any,
      }).select("id").single();
      if (error) throw error;
      // Auto-record accounting entries for invoices
      if (folder === "invoice") {
        try {
          // Extract invoice total: prefer a line mentioning "total"/"grand total"/"amount",
          // else fall back to the largest plausible currency number (<= 1e9).
          const parseCurrencyNums = (s: string) =>
            Array.from(
              s.matchAll(/(?:₹|\$|€|£|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]+)?|[0-9]+\.[0-9]{2})/g)
            )
              .map((m) => parseFloat(m[1].replace(/,/g, "")))
              .filter((n) => !isNaN(n) && n >= 1 && n <= 1e9);
          const lines = fieldsForBake.map((f) => f.text);
          const totalLines = lines.filter((t) => /grand\s*total|\btotal\b|amount\s*(due|payable)?/i.test(t));
          let amount = 0;
          for (const t of totalLines) {
            const n = parseCurrencyNums(t);
            if (n.length) { amount = Math.max(amount, ...n); }
          }
          if (!amount) {
            const n = parseCurrencyNums(lines.join(" \n "));
            amount = n.length ? Math.max(...n) : 0;
          }
          if (amount > 0) {
            const docId = (newDoc as any)?.id ?? null;
            const desc = `Invoice ${finalInvoice ?? safe}`;
            const entry_date = new Date().toISOString().slice(0, 10);
            // Avoid duplicates: clear any prior entries for this same invoice
            await supabase.from("ledger_entries" as any).delete().eq("description", desc);
            await supabase.from("ledger_entries" as any).insert([
              { entry_date, account: "Accounts Receivable", entry_type: "debit", amount, description: desc, document_id: docId },
              { entry_date, account: "Sales Revenue", entry_type: "credit", amount, description: desc, document_id: docId },
            ]);
          }
        } catch { /* non-fatal */ }
      }
      toast.success(`Saved to ${folderMeta[folder].title}`);
      qc.invalidateQueries({ queryKey: ["folder", folder] });
      qc.invalidateQueries({ queryKey: ["recent"] });
      qc.invalidateQueries({ queryKey: ["recent-all"] });
      qc.invalidateQueries({ queryKey: ["document-search"] });
      qc.invalidateQueries({ queryKey: ["ledger-entries"] });
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
      qc.invalidateQueries({ queryKey: ["document-search"] });
      qc.invalidateQueries({ queryKey: ["ledger-entries"] });
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
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setInsertOpen((v) => !v)}>
            Insert ▾
          </Button>
          {insertOpen && (
            <div className="absolute z-50 top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-lg p-1 min-w-[220px]">
              <button
                onClick={insertInvoiceTable}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-muted text-left"
              >
                <TableIcon className="h-4 w-4" /> Table (invoice, 7 columns)
              </button>
            </div>
          )}
        </div>
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
            {invoiceTable && (
              <div className="border-b border-border px-4 py-4 space-y-4">
                <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">GST CALCULATION</div>

                {/* Exclusive / Inclusive */}
                <div className="grid grid-cols-2 gap-3">
                  {(["exclusive", "inclusive"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => changeGstMode(m)}
                      className={`h-11 rounded-md border text-sm font-medium capitalize transition-colors ${
                        gstMode === m
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {gstMode === "exclusive"
                    ? "GST is added to the entered amount."
                    : "GST is included in the entered amount."}
                </p>

                {invoiceLineRows.map(({ row, index }) => {
                  const r = index;
                  const taxType = taxTypes[r] ?? "IGST";
                  const gstAmount = num(row[6]?.text ?? "") - num(row[4]?.text ?? "");
                  return (
                    <div key={r} className="rounded-lg border border-border p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-11 flex-1"
                          placeholder="Requirements"
                          value={row[0]?.text ?? ""}
                          onChange={(e) => setLineCell(r, 0, e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => removeLineItem(r)}
                          className="h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center"
                          title="Remove line item"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">HSN</span>
                          <Input className="h-11" placeholder="HSN" value={row[1]?.text ?? ""}
                            onChange={(e) => setLineCell(r, 1, e.target.value)} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Unit price</span>
                          <Input className="h-11" placeholder="Unit price" value={row[2]?.text ?? ""}
                            onChange={(e) => setLineCell(r, 2, e.target.value)} />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3 items-end">
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Quantity</span>
                          <Input className="h-11" placeholder="1" value={row[3]?.text ?? ""}
                            onChange={(e) => setLineCell(r, 3, e.target.value)} />
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">GST</span>
                          <select
                            className="h-11 flex-1 rounded-md border border-input bg-muted/40 px-2 text-sm"
                            value={String(rateOf(row[5]?.text ?? ""))}
                            onChange={(e) => setLineCell(r, 5, `${e.target.value}%`)}
                          >
                            {[0, 5, 12, 18, 28].map((v) => <option key={v} value={v}>{v}%</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Taxable amount</span>
                          <Input className="h-11 bg-muted/50" readOnly value={row[4]?.text || "0.00"} />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Total</span>
                          <Input className="h-11 bg-muted/50" readOnly value={row[6]?.text || "0.00"} />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3 items-end">
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Tax type</span>
                          <select
                            className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={taxType}
                            onChange={(e) => setTaxTypes((p) => ({ ...p, [r]: e.target.value }))}
                          >
                            <option value="IGST">IGST</option>
                            <option value="CGST+SGST">CGST + SGST</option>
                          </select>
                        </label>
                        <div className="h-[68px] rounded-md bg-muted/50 px-3 flex items-center text-sm text-muted-foreground">
                          {taxType === "IGST"
                            ? `IGST ₹${money(gstAmount)}`
                            : `CGST ₹${money(gstAmount / 2)} · SGST ₹${money(gstAmount / 2)}`}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={addLineItem}
                  className="w-full h-11 rounded-md border border-border bg-muted/30 hover:bg-muted text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" /> Add line item
                </button>

                <div className="rounded-md bg-muted/60 px-3 py-3 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span>Taxable Value</span><span>₹{money(gstTotals.taxable)}</span></div>
                  <div className="flex justify-between"><span>GST</span><span>₹{money(gstTotals.gst)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Grand Total</span><span>₹{money(gstTotals.total)}</span></div>
                </div>
              </div>
            )}
            {doc.folder === "invoice" && !invoiceTable && (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Use <span className="font-medium text-foreground">Insert → Table</span> to add the invoice
                table, then edit line items here.
              </div>
            )}
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

          {/* Table toolbar */}
          {selectedTable && (
            <div className="border-b border-border bg-muted/40 px-4 py-2 flex items-center gap-2 flex-wrap text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TableIcon className="h-4 w-4" /><span>Table</span>
              </div>
              <div className="h-5 w-px bg-border" />
              <Button size="sm" variant="outline" onClick={() => addRow(false)}><Plus className="h-3 w-3 mr-1" />Row above</Button>
              <Button size="sm" variant="outline" onClick={() => addRow(true)}><Plus className="h-3 w-3 mr-1" />Row below</Button>
              <Button size="sm" variant="outline" onClick={delRow}><Minus className="h-3 w-3 mr-1" />Row</Button>
              <div className="h-5 w-px bg-border" />
              <Button size="sm" variant="outline" onClick={() => addCol(false)}><Plus className="h-3 w-3 mr-1" />Col left</Button>
              <Button size="sm" variant="outline" onClick={() => addCol(true)}><Plus className="h-3 w-3 mr-1" />Col right</Button>
              <Button size="sm" variant="outline" onClick={delCol}><Minus className="h-3 w-3 mr-1" />Col</Button>
              <div className="h-5 w-px bg-border" />
              {/* Cell-level formatting */}
              <Button size="icon" variant={selCell?.bold ? "default" : "outline"} className="h-8 w-8" disabled={!selCell} onClick={() => patchCell({ bold: !selCell?.bold })}><Bold className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant={selCell?.italic ? "default" : "outline"} className="h-8 w-8" disabled={!selCell} onClick={() => patchCell({ italic: !selCell?.italic })}><Italic className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant={selCell?.underline ? "default" : "outline"} className="h-8 w-8" disabled={!selCell} onClick={() => patchCell({ underline: !selCell?.underline })}><Underline className="h-3.5 w-3.5" /></Button>
              <select disabled={!selCell} value={selCell?.fontFamily ?? "Arial"} onChange={(e) => patchCell({ fontFamily: e.target.value })}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[130px]"
                style={{ fontFamily: selCell?.fontFamily ?? "Arial" }}>
                {FONT_FAMILIES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
              <Input type="number" min={6} max={96} disabled={!selCell}
                value={selCell?.fontSize ?? 11}
                onChange={(e) => patchCell({ fontSize: Math.max(6, Math.min(96, Number(e.target.value) || 11)) })}
                className="h-8 w-16" />
              <label className="flex items-center gap-1 text-xs">Text
                <input type="color" disabled={!selCell} value={selCell?.color ?? "#0b1320"} onChange={(e) => patchCell({ color: e.target.value })} className="h-7 w-8 rounded border border-border p-0" />
              </label>
              <label className="flex items-center gap-1 text-xs">Fill
                <input type="color" disabled={!selCell} value={selCell?.bg ?? "#ffffff"} onChange={(e) => patchCell({ bg: e.target.value })} className="h-7 w-8 rounded border border-border p-0" />
              </label>
              <Button size="icon" variant={selCell?.hAlign === "left" ? "default" : "outline"} className="h-8 w-8" disabled={!selCell} onClick={() => patchCell({ hAlign: "left" })}><AlignLeft className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant={selCell?.hAlign === "center" ? "default" : "outline"} className="h-8 w-8" disabled={!selCell} onClick={() => patchCell({ hAlign: "center" })}><AlignCenter className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant={selCell?.hAlign === "right" ? "default" : "outline"} className="h-8 w-8" disabled={!selCell} onClick={() => patchCell({ hAlign: "right" })}><AlignRight className="h-3.5 w-3.5" /></Button>
              <select disabled={!selCell} value={selCell?.vAlign ?? "middle"} onChange={(e) => patchCell({ vAlign: e.target.value as any })}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
              </select>
              <label className="flex items-center gap-1 text-xs">Pad
                <Input type="number" min={0} max={40} disabled={!selCell} value={selCell?.padding ?? 4}
                  onChange={(e) => patchCell({ padding: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })}
                  className="h-8 w-14" />
              </label>
              <div className="h-5 w-px bg-border" />
              <label className="flex items-center gap-1 text-xs">Border
                <input type="color" value={selectedTable.borderColor} onChange={(e) => updateTable(selectedTable.id, { borderColor: e.target.value })} className="h-7 w-8 rounded border border-border p-0" />
                <Input type="number" min={0} max={8} step={0.5} value={selectedTable.borderWidth}
                  onChange={(e) => updateTable(selectedTable.id, { borderWidth: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })}
                  className="h-8 w-14" />
                <Button size="sm" variant={selectedTable.borderVisible ? "default" : "outline"}
                  onClick={() => updateTable(selectedTable.id, { borderVisible: !selectedTable.borderVisible })}>
                  {selectedTable.borderVisible ? "Show" : "Hide"}
                </Button>
              </label>
              <Button size="sm" variant="destructive" onClick={deleteTable} className="ml-auto">
                <Trash2 className="h-3.5 w-3.5 mr-1" />Delete table
              </Button>
            </div>
          )}

          {/* Preview */}
          <div ref={previewWrapRef} className="flex-1 overflow-auto bg-muted/30 p-6">
            <div className="flex flex-col items-center gap-6">
              {pageNumbers.map((pn) => {
                const size = pageSizes[pn - 1];
                if (!size) return null;
                const list = fieldsByPage.get(pn) ?? [];
                const wPx = size.wPt * pageScale;
                const hPx = size.hPt * pageScale;
                const pageTables = tables.filter((t) => t.page === pn);
                return (
                  <div key={pn} className="relative shadow-lg bg-white"
                    onMouseDown={() => { setSelectedTableId(null); setSelectedCell(null); }}
                    style={{ width: wPx, height: hPx }}>
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
                    {/* Table overlays */}
                    {pageTables.map((t) => (
                      <TableOverlayView
                        key={t.id}
                        table={t}
                        scale={pageScale}
                        selected={selectedTableId === t.id}
                        selectedCell={selectedTableId === t.id ? selectedCell : null}
                        onSelect={() => setSelectedTableId(t.id)}
                        onSelectCell={(r, c) => setSelectedCell({ r, c })}
                        onChange={(nt) => updateTable(t.id, nt)}
                      />
                    ))}
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