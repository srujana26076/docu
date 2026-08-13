import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSubfolders, folderMeta, type Folder } from "@/lib/documents";

const FOLDERS: Folder[] = ["invoice", "quotation", "offer_letter", "template"];

export function encodeDest(folder: Folder, subfolderId: string | null) {
  return subfolderId ? `${folder}::${subfolderId}` : folder;
}
export function decodeDest(value: string): { folder: Folder; subfolderId: string | null } {
  const [f, sub] = value.split("::");
  return { folder: f as Folder, subfolderId: sub ?? null };
}

/** Folder picker showing every top-level folder with its sub-folders nested underneath. */
export function FolderSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (folder: Folder, subfolderId: string | null) => void;
  className?: string;
}) {
  const subs = useQuery({ queryKey: ["subfolders"], queryFn: () => listSubfolders() });

  return (
    <Select value={value} onValueChange={(v) => { const d = decodeDest(v); onChange(d.folder, d.subfolderId); }}>
      <SelectTrigger className={className ?? "w-56 h-9"}><SelectValue /></SelectTrigger>
      <SelectContent>
        {FOLDERS.map((f) => (
          <div key={f}>
            <SelectItem value={f}>{folderMeta[f].title}</SelectItem>
            {(subs.data ?? []).filter((s) => s.folder === f).map((s) => (
              <SelectItem key={s.id} value={encodeDest(f, s.id)} className="pl-8">
                └ {s.name}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}
