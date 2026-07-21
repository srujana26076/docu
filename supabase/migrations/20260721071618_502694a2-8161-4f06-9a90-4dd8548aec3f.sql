CREATE TABLE public.ledger_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  account text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('debit','credit')),
  amount numeric NOT NULL DEFAULT 0,
  description text,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_entries TO anon, authenticated;
GRANT ALL ON public.ledger_entries TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ledger" ON public.ledger_entries FOR SELECT USING (true);
CREATE POLICY "Public insert ledger" ON public.ledger_entries FOR INSERT WITH CHECK (true);
CREATE INDEX ledger_entries_entry_date_idx ON public.ledger_entries(entry_date DESC);