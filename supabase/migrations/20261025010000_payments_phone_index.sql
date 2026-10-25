-- The checkout abuse guard counts recent payments per phone number (across tenants).
CREATE INDEX IF NOT EXISTS payments_phone_created_idx ON public.payments (phone, created_at DESC);
