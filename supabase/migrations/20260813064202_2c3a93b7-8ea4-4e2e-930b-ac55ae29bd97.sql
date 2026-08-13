ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS gstin text;

UPDATE public.clients SET email = COALESCE(email,''), phone = COALESCE(phone,''), address = COALESCE(address,'');

ALTER TABLE public.clients
  ALTER COLUMN email SET DEFAULT '', ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN phone SET DEFAULT '', ALTER COLUMN phone SET NOT NULL,
  ALTER COLUMN address SET DEFAULT '', ALTER COLUMN address SET NOT NULL;

DROP POLICY IF EXISTS "Public read clients" ON public.clients;
DROP POLICY IF EXISTS "Public insert clients" ON public.clients;
DROP POLICY IF EXISTS "Public update clients" ON public.clients;
DROP POLICY IF EXISTS "Public delete clients" ON public.clients;

REVOKE ALL ON public.clients FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read clients" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update clients" ON public.clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete clients" ON public.clients FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';