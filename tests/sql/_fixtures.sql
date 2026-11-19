-- Shared fixtures: two tenants and one user per role. Included with \ir.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tenant A', 'tenant-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b');

CREATE TEMP TABLE u (label text PRIMARY KEY, id uuid, tenant uuid, role public.app_role);
INSERT INTO u VALUES
  ('admin',   '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'tenant_admin'),
  ('tech',    '11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'technician'),
  ('billing', '11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'billing_agent'),
  ('support', '11111111-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'support_staff'),
  ('adminB',  '11111111-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000002', 'tenant_admin'),
  ('super',   '11111111-0000-0000-0000-000000000006', NULL,                                   'super_admin');

INSERT INTO auth.users (id, email) SELECT id, label || '@test.local' FROM u;
INSERT INTO public.profiles (id, email, tenant_id)
  SELECT id, label || '@test.local', tenant FROM u
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
INSERT INTO public.user_roles (user_id, role, tenant_id) SELECT id, role, tenant FROM u;

