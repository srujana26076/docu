import { useState, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from "react";

export interface TableCell {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bg?: string;
  hAlign?: "left" | "center" | "right";
  vAlign?: "top" | "middle" | "bottom";
  padding?: number;
  colSpan?: number;
}
export interface TableData {
  id: string;
  page: number; // 1-based
  x: number; // pdf points, top-left in pdf top-down coords (y from top of page)
  y: number;
  colWidths: number[]; // pdf points
  rowHeights: number[]; // pdf points
  cells: TableCell[][];
  borderColor: string;
  borderWidth: number;
  borderVisible: boolean;
}

export function defaultCell(): TableCell {
  return {
    text: "",
    fontFamily: "Arial",
    fontSize: 11,
    color: "#0b1320",
    bg: "#ffffff",
    hAlign: "left",
    vAlign: "middle",
    padding: 4,
  };
}
export function makeTable(page: number, rows: number, cols: number, x = 60, y = 100): TableData {
  const colW = 80, rowH = 24;
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    x, y,
    colWidths: new Array(cols).fill(colW),
    rowHeights: new Array(rows).fill(rowH),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, defaultCell)),
    borderColor: "#334155",
    borderWidth: 1,
    borderVisible: true,
  };
}

interface Props {
  table: TableData;
  scale: number;
  selected: boolean;
  selectedCell: { r: number; c: number } | null;
  onSelect: () => void;
  onSelectCell: (r: number, c: number) => void;
  onChange: (t: TableData) => void;
}

export function TableOverlayView({ table, scale, selected, selectedCell, onSelect, onSelectCell, onChange }: Props) {
  const totalW = table.colWidths.reduce((a, b) => a + b, 0);
  const totalH = table.rowHeights.reduce((a, b) => a + b, 0);
  const [drag, setDrag] = useState<null | { sx: number; sy: number; ox: number; oy: number; moved: boolean }>(null);
  const [rez, setRez] = useState<null | { sx: number; sy: number; cw: number[]; rh: number[] }>(null);

  // drag move
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const dx = (e.clientX - drag.sx) / scale;
      const dy = (e.clientY - drag.sy) / scale;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 2) {
        setDrag({ ...drag, moved: true });
      }
      onChange({ ...table, x: drag.ox + dx, y: drag.oy + dy });
    };
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [drag, scale, onChange, table]);

  const startMove = useCallback((e: ReactMouseEvent, shouldPreventDefault = false) => {
    e.stopPropagation();
    if (shouldPreventDefault) e.preventDefault();
    onSelect();
    setDrag({ sx: e.clientX, sy: e.clientY, ox: table.x, oy: table.y, moved: false });
  }, [onSelect, table.x, table.y]);

  // resize (uniform scale)
  useEffect(() => {
    if (!rez) return;
    const move = (e: MouseEvent) => {
      const dx = (e.clientX - rez.sx) / scale;
      const dy = (e.clientY - rez.sy) / scale;
      const startW = rez.cw.reduce((a, b) => a + b, 0);
      const startH = rez.rh.reduce((a, b) => a + b, 0);
      const kx = Math.max(0.3, (startW + dx) / startW);
      const ky = Math.max(0.3, (startH + dy) / startH);
      onChange({
        ...table,
        colWidths: rez.cw.map((w) => Math.max(20, w * kx)),
        rowHeights: rez.rh.map((h) => Math.max(14, h * ky)),
      });
    };
    const up = () => setRez(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [rez, scale, onChange, table]);

  const editCell = useCallback((r: number, c: number, patch: Partial<TableCell>) => {
    const next = table.cells.map((row) => row.slice());
    next[r][c] = { ...next[r][c], ...patch };
    onChange({ ...table, cells: next });
  }, [table, onChange]);

  const border = table.borderVisible ? `${table.borderWidth}px solid ${table.borderColor}` : "1px dashed rgba(0,0,0,0.15)";

  return (
    <div
      data-table
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        position: "absolute",
        left: table.x * scale,
        top: table.y * scale,
        width: totalW * scale,
        height: totalH * scale,
        outline: selected ? "2px solid var(--ring)" : "none",
        outlineOffset: 2,
        cursor: drag ? "grabbing" : selected ? "grab" : "default",
        zIndex: 5,
      }}
    >
      {/* Move bar (top) — click and drag to move */}
      {selected && (
        <div
          onMouseDown={(e) => startMove(e, true)}
          style={{
            position: "absolute", left: 0, right: 0, top: -22, height: 20,
            background: "var(--primary)", color: "var(--primary-foreground)",
            borderTopLeftRadius: 4, borderTopRightRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, cursor: drag ? "grabbing" : "grab",
            userSelect: "none", zIndex: 20, pointerEvents: "auto",
          }}
          title="Drag to move table"
        >✥ move</div>
      )}
      {/* cells */}
      <div style={{ display: "grid", gridTemplateColumns: table.colWidths.map((w) => `${w * scale}px`).join(" "), gridTemplateRows: table.rowHeights.map((h) => `${h * scale}px`).join(" ") }}>
        {table.cells.map((row, r) =>
          row.map((cell, c) => {
            let covered = false;
            for (let i = 0; i < c; i++) {
              const s = row[i]?.colSpan ?? 1;
              if (s > 1 && i + s > c) { covered = true; break; }
            }
            if (covered) return null;
            const span = Math.min(cell.colSpan ?? 1, row.length - c);
            const isSel = selectedCell?.r === r && selectedCell?.c === c && selected;
            return (
              <div
                key={`${r}-${c}`}
                onMouseDown={(e) => { startMove(e); onSelectCell(r, c); }}
                onDoubleClick={(e) => {
                  const el = e.currentTarget.querySelector<HTMLDivElement>("[data-ce]");
                  el?.focus();
                }}
                style={{
                  border,
                  gridColumn: span > 1 ? `span ${span}` : undefined,
                  background: cell.bg || "#ffffff",
                  padding: (cell.padding ?? 4) * scale,
                  display: "flex",
                  alignItems: cell.vAlign === "top" ? "flex-start" : cell.vAlign === "bottom" ? "flex-end" : "center",
                  justifyContent: cell.hAlign === "center" ? "center" : cell.hAlign === "right" ? "flex-end" : "flex-start",
                  overflow: "hidden",
                  outline: isSel ? "2px solid var(--primary)" : "none",
                  outlineOffset: -2,
                  boxSizing: "border-box",
                }}
              >
                <div
                  data-ce
                  contentEditable
                  suppressContentEditableWarning
                  tabIndex={0}
                  onFocus={() => { onSelect(); onSelectCell(r, c); }}
                  onInput={(e) => editCell(r, c, { text: (e.target as HTMLDivElement).innerText })}
                  onKeyDown={(e) => {
                    const R = table.cells.length, C = table.cells[0].length;
                    let nr = r, nc = c, handled = false;
                    if (e.key === "Tab") { handled = true; nc = c + (e.shiftKey ? -1 : 1); if (nc >= C) { nc = 0; nr = Math.min(R - 1, nr + 1); } if (nc < 0) { nc = C - 1; nr = Math.max(0, nr - 1); } }
                    else if (e.key === "ArrowRight" && (e.target as HTMLElement).textContent === "") { handled = true; nc = Math.min(C - 1, c + 1); }
                    else if (e.key === "ArrowLeft" && (e.target as HTMLElement).textContent === "") { handled = true; nc = Math.max(0, c - 1); }
                    else if (e.key === "ArrowDown" && e.ctrlKey) { handled = true; nr = Math.min(R - 1, r + 1); }
                    else if (e.key === "ArrowUp" && e.ctrlKey) { handled = true; nr = Math.max(0, r - 1); }
                    if (handled) {
                      e.preventDefault();
                      onSelectCell(nr, nc);
                      const nextEl = (e.currentTarget.closest("[data-table]") ?? document).querySelectorAll<HTMLDivElement>("[data-ce]")[nr * C + nc];
                      nextEl?.focus();
                    }
                  }}
                  style={{
                    outline: "none",
                    fontFamily: `${cell.fontFamily || "Arial"}, Arial, sans-serif`,
                    fontSize: (cell.fontSize || 11) * scale,
                    fontWeight: cell.bold ? 700 : 400,
                    fontStyle: cell.italic ? "italic" : "normal",
                    textDecoration: cell.underline ? "underline" : "none",
                    color: cell.color || "#0b1320",
                    textAlign: cell.hAlign || "left",
                    width: "100%",
                    lineHeight: 1.2,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >{cell.text}</div>
              </div>
            );
          })
        )}
      </div>

      {/* corner resize handle */}
      {selected && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setRez({ sx: e.clientX, sy: e.clientY, cw: table.colWidths.slice(), rh: table.rowHeights.slice() });
          }}
          style={{
            position: "absolute", right: -6, bottom: -6, width: 12, height: 12,
            background: "white", border: "2px solid var(--primary)", borderRadius: 2, cursor: "nwse-resize",
          }}
        />
      )}
    </div>
  );
}

// Word-style grid picker
export function TableGridPicker({ onPick, onClose }: { onPick: (rows: number, cols: number) => void; onClose: () => void }) {
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const MAX_R = 8, MAX_C = 10;
  return (
    <div onMouseLeave={() => setHover({ r: 0, c: 0 })}>
      <div className="text-xs font-medium mb-2 text-center">
        {hover.r > 0 && hover.c > 0 ? `${hover.r} × ${hover.c} Table` : "Insert Table"}
      </div>
      <div
        className="grid gap-0.5 p-1 bg-muted/40 rounded"
        style={{ gridTemplateColumns: `repeat(${MAX_C}, 18px)` }}
      >
        {Array.from({ length: MAX_R * MAX_C }).map((_, i) => {
          const r = Math.floor(i / MAX_C) + 1;
          const c = (i % MAX_C) + 1;
          const active = r <= hover.r && c <= hover.c;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => { onPick(r, c); onClose(); }}
              style={{
                width: 18, height: 18,
                border: "1px solid #64748b",
                background: active ? "hsl(var(--primary))" : "#ffffff",
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
