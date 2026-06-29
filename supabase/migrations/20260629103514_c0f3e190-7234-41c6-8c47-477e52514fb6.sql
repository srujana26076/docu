
CREATE TYPE public.folder_type AS ENUM ('invoice','quotation','offer_letter','template');

CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  folder public.folder_type NOT NULL,
  storage_path TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO anon, authenticated;
GRANT ALL ON public.documents TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read documents" ON public.documents FOR SELECT USING (true);
CREATE POLICY "Public insert documents" ON public.documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update documents" ON public.documents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete non-default" ON public.documents FOR DELETE USING (is_default = false);

CREATE POLICY "Public read storage documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "Public upload storage documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Public update storage documents" ON storage.objects FOR UPDATE USING (bucket_id = 'documents');
CREATE POLICY "Public delete storage documents" ON storage.objects FOR DELETE USING (bucket_id = 'documents');

CREATE INDEX idx_documents_folder ON public.documents(folder, created_at DESC);
