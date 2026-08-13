import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ClientFormDialog } from "@/components/ClientForm";
import { listClients, createClient, type Client } from "@/lib/clients";
import { Users, Check, UserPlus } from "lucide-react";

/** Searchable client dropdown with inline "add new client". */
export function ClientPicker({
  value, onSelect,
}: {
  value: string | null;
  onSelect: (client: Client | null) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["clients"], queryFn: listClients });
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const current = (q.data ?? []).find((c) => c.id === value) ?? null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-56 justify-start">
            <Users className="h-4 w-4 mr-2 shrink-0" />
            <span className="truncate">{current ? current.name : "Select client"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-64" align="start">
          <Command>
            <CommandInput placeholder="Search clients…" />
            <CommandList>
              <CommandEmpty>No clients found.</CommandEmpty>
              <CommandGroup>
                {(q.data ?? []).map((c) => (
                  <CommandItem key={c.id} value={c.name} onSelect={() => { onSelect(c); setOpen(false); }}>
                    <Check className={`h-4 w-4 mr-2 ${c.id === value ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{c.name}</span>
                  </CommandItem>
                ))}
                <CommandItem value="__add" onSelect={() => { setOpen(false); setAdding(true); }}>
                  <UserPlus className="h-4 w-4 mr-2" />Add new client…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <ClientFormDialog
        open={adding} onOpenChange={setAdding} title="Add client"
        onSubmit={async (input) => {
          const c = await createClient(input);
          toast.success("Client added");
          qc.invalidateQueries({ queryKey: ["clients"] });
          onSelect(c);
        }}
      />
    </>
  );
}
