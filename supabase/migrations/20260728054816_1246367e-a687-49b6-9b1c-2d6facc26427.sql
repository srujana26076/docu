DELETE FROM public.ledger_entries le
WHERE le.document_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = le.document_id);

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_document_id_fkey;

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

GRANT DELETE ON public.ledger_entries TO anon, authenticated;
GRANT ALL ON public.ledger_entries TO service_role;

CREATE POLICY "Public delete ledger" ON public.ledger_entries FOR DELETE USING (true);