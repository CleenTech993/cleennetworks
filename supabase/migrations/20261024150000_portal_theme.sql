-- Captive-portal theme chosen by the ISP. The list of themes lives in application code
-- (src/lib/portal-themes.ts); unknown values fall back to 'classic', so adding a theme later
-- needs no migration. Existing portals keep the look they had ('classic').
ALTER TABLE public.captive_portals
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'classic'
  CHECK (theme ~ '^[a-z0-9_-]{1,32}$');
