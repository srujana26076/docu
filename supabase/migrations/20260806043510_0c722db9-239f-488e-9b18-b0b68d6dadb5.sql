ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_payment_status_check CHECK (payment_status IN ('unpaid','paid','overdue'));