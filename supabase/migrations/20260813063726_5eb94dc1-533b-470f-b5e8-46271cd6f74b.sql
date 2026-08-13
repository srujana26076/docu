CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO anon;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read clients" ON public.clients FOR SELECT USING (true);
CREATE POLICY "Public insert clients" ON public.clients FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update clients" ON public.clients FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete clients" ON public.clients FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS public.subfolders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  folder public.folder_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subfolders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subfolders TO anon;
GRANT ALL ON public.subfolders TO service_role;
ALTER TABLE public.subfolders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read subfolders" ON public.subfolders FOR SELECT USING (true);
CREATE POLICY "Public insert subfolders" ON public.subfolders FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update subfolders" ON public.subfolders FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete subfolders" ON public.subfolders FOR DELETE USING (true);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subfolder_id uuid REFERENCES public.subfolders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_subfolder_id_idx ON public.documents(subfolder_id);
CREATE INDEX IF NOT EXISTS documents_client_id_idx ON public.documents(client_id);

NOTIFY pgrst, 'reload schema';