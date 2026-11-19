CREATE UNIQUE INDEX IF NOT EXISTS work_orders_ticket_id_unique_idx
  ON public.work_orders (ticket_id)
  WHERE ticket_id IS NOT NULL;
