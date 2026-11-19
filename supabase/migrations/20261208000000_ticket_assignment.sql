ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_support_ticket_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF NOT public.is_super_admin(auth.uid())
       AND NOT public.has_tenant_role(
         auth.uid(),
         NEW.tenant_id,
         ARRAY['tenant_admin']::public.app_role[]
       ) THEN
      RAISE EXCEPTION 'Only tenant admins can assign support tickets';
    END IF;

    IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = NEW.assigned_to
        AND ur.tenant_id = NEW.tenant_id
        AND ur.role = ANY (
          ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
        )
    ) THEN
      RAISE EXCEPTION 'Support tickets can only be assigned to tenant support staff';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_support_ticket_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validate_support_ticket_assignee ON public.support_tickets;
CREATE TRIGGER validate_support_ticket_assignee
  BEFORE INSERT OR UPDATE OF assigned_to, tenant_id ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_support_ticket_assignee();
