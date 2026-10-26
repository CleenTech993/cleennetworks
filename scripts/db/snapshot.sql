-- One row per database object in the public schema that a migration can create.
-- Used twice from one source of truth: to take a snapshot after each migration on a scratch
-- database (scripts/db/gen-live-check.mjs), and embedded in supabase/verify_live_db.sql so the
-- live database is read the same way. Read-only.
select kind, ident from (
  select 'table'::text as kind, 'public.' || c.relname as ident
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'column', 'public.' || c.relname || '.' || a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
  union all
  select 'function', 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
  union all
  select 'policy', 'public.' || tablename || '.' || policyname
    from pg_policies where schemaname = 'public'
  union all
  select 'trigger', 'public.' || c.relname || '.' || t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'index', 'public.' || indexname from pg_indexes where schemaname = 'public'
  union all
  select 'constraint', 'public.' || c.relname || '.' || k.conname
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select 'enum', t.typname || '.' || e.enumlabel
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
  union all
  select 'rls', 'public.' || c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity
) s
