import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Client, ClientInput } from "@/lib/clients";

const empty: ClientInput = { name: "", email: "", phone: "", address: "", gstin: "" };

export function ClientFormDialog({
  open, onOpenChange, initial, onSubmit, title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Client | null;
  onSubmit: (input: ClientInput) => Promise<void>;
  title: string;
}) {
  const [form, setForm] = useState<ClientInput>(
    initial ? { name: initial.name, email: initial.email, phone: initial.phone, address: initial.address, gstin: initial.gstin ?? "" } : empty,
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ClientInput) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.address.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ ...form, name: form.name.trim() });
      onOpenChange(false);
      if (!initial) setForm(empty);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Name *" value={form.name} onChange={set("name")} />
          <Input placeholder="Email *" value={form.email} onChange={set("email")} />
          <Input placeholder="Phone *" value={form.phone} onChange={set("phone")} />
          <Input placeholder="Address *" value={form.address} onChange={set("address")} />
          <Input placeholder="GSTIN (optional)" value={form.gstin ?? ""} onChange={set("gstin")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save client"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
