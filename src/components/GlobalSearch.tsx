import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, FileText, X } from "lucide-react";
import { searchDocuments, folderMeta } from "@/lib/documents";
import { supabase } from "@/integrations/supabase/client";

export function GlobalSearch() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const searchTerm = term.trim();
  const q = useQuery({
    queryKey: ["document-search", searchTerm.toLowerCase()],
    queryFn: () => searchDocuments(searchTerm),
    enabled: searchTerm.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  useEffect(() => {
    const channel = supabase
      .channel("global-document-search")
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => {
        queryClient.invalidateQueries({ queryKey: ["document-search"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  const results = q.data ?? [];

  return (
    <div className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search all documents by name or invoice number…"
        aria-label="Search documents"
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {term && (
        <button
          type="button"
          onClick={() => setTerm("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && searchTerm && (
        <div className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {q.isFetching ? (
            <div className="p-4 text-sm text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No documents found</div>
          ) : (
            results.map((d) => (
              <button
                key={d.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setTerm("");
                  navigate({ to: "/editor/$id", params: { id: d.id } });
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {d.name}
                  {d.invoice_number ? <span className="text-muted-foreground"> · {d.invoice_number}</span> : null}
                </span>
                <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                  {d.folder === "offer_letter" ? "Offer Letter" : folderMeta[d.folder].title.replace(/s$/, "")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}