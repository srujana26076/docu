
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_date TEXT;

CREATE TABLE IF NOT EXISTS public.invoice_counter (
  id INT PRIMARY KEY DEFAULT 1,
  last_number INT NOT NULL DEFAULT 5032,
  prefix TEXT NOT NULL DEFAULT 'IVHPS',
  CONSTRAINT invoice_counter_one_row CHECK (id = 1)
);
INSERT INTO public.invoice_counter (id, last_number, prefix)
VALUES (1, 5032, 'IVHPS') ON CONFLICT (id) DO NOTHING;

GRANT SELECT, UPDATE ON public.invoice_counter TO anon, authenticated;
GRANT ALL ON public.invoice_counter TO service_role;

ALTER TABLE public.invoice_counter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "counter read" ON public.invoice_counter;
DROP POLICY IF EXISTS "counter update" ON public.invoice_counter;
CREATE POLICY "counter read" ON public.invoice_counter FOR SELECT USING (true);
CREATE POLICY "counter update" ON public.invoice_counter FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.allocate_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE n INT; pfx TEXT; today TEXT;
BEGIN
  UPDATE public.invoice_counter SET last_number = last_number + 1
    WHERE id = 1
    RETURNING last_number, prefix INTO n, pfx;
  today := to_char(now() AT TIME ZONE 'UTC', 'MMDD');
  RETURN pfx || '-' || today || '-' || lpad(n::text, 4, '0');
END $$;

GRANT EXECUTE ON FUNCTION public.allocate_invoice_number() TO anon, authenticated;
