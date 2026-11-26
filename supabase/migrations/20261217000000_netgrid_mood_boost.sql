CREATE TABLE IF NOT EXISTS public.mood_boost_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  country_code text NOT NULL DEFAULT 'KE',
  primary_language text NOT NULL DEFAULT 'en',
  secondary_language text,
  categories text[] NOT NULL DEFAULT ARRAY[
    'isp_life','wifi_problems','customer_behaviour','mpesa_moments',
    'network_technicians','router_problems','internet_speed','business_life',
    'local_life','technology','trending_topics','weekend_humour'
  ],
  content_frequency text NOT NULL DEFAULT 'daily',
  show_trending boolean NOT NULL DEFAULT true,
  show_isp_humour boolean NOT NULL DEFAULT true,
  contextual_humour_enabled boolean NOT NULL DEFAULT false,
  sound_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mood_boost_settings_country_check CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT mood_boost_settings_primary_language_check CHECK (primary_language ~ '^[a-z]{2,3}([_-][A-Za-z0-9]{2,8})?$'),
  CONSTRAINT mood_boost_settings_secondary_language_check CHECK (
    secondary_language IS NULL OR secondary_language ~ '^[a-z]{2,3}([_-][A-Za-z0-9]{2,8})?$'
  ),
  CONSTRAINT mood_boost_settings_frequency_check CHECK (content_frequency IN ('daily','manual')),
  CONSTRAINT mood_boost_settings_categories_check CHECK (categories <@ ARRAY[
    'isp_life','wifi_problems','customer_behaviour','mpesa_moments',
    'network_technicians','router_problems','internet_speed','business_life',
    'local_life','technology','trending_topics','weekend_humour'
  ]::text[])
);

CREATE TABLE IF NOT EXISTS public.mood_boost_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  language text NOT NULL,
  topic text NOT NULL,
  source text NOT NULL,
  source_reference text NOT NULL,
  relevance_score numeric(4,3) NOT NULL DEFAULT 0.500,
  status text NOT NULL DEFAULT 'pending',
  safety_confirmed boolean NOT NULL DEFAULT false,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mood_boost_topics_country_check CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT mood_boost_topics_language_check CHECK (language ~ '^[a-z]{2,3}([_-][A-Za-z0-9]{2,8})?$'),
  CONSTRAINT mood_boost_topics_relevance_check CHECK (relevance_score BETWEEN 0 AND 1),
  CONSTRAINT mood_boost_topics_status_check CHECK (status IN ('pending','active','rejected')),
  CONSTRAINT mood_boost_topics_safety_check CHECK (status <> 'active' OR safety_confirmed)
);

ALTER TABLE public.mood_boost_topics
  ADD COLUMN IF NOT EXISTS safety_confirmed boolean NOT NULL DEFAULT false;
UPDATE public.mood_boost_topics
SET status = 'pending', reviewed_by = NULL
WHERE status = 'active' AND NOT safety_confirmed;
ALTER TABLE public.mood_boost_topics
  DROP CONSTRAINT IF EXISTS mood_boost_topics_safety_check;
ALTER TABLE public.mood_boost_topics
  ADD CONSTRAINT mood_boost_topics_safety_check CHECK (status <> 'active' OR safety_confirmed);

CREATE TABLE IF NOT EXISTS public.mood_boost_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  caption text NOT NULL,
  original_caption text,
  image_url text,
  source_topic_id uuid REFERENCES public.mood_boost_topics(id) ON DELETE SET NULL,
  source_topic text,
  source_reference text,
  relevance_score numeric(4,3) NOT NULL DEFAULT 0.500,
  moderation_status text NOT NULL DEFAULT 'pending',
  moderation_result jsonb,
  campaign_tag text NOT NULL DEFAULT 'evergreen',
  campaign_enabled boolean NOT NULL DEFAULT true,
  generation_day date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT mood_boost_content_country_check CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT mood_boost_content_language_check CHECK (language ~ '^[a-z]{2,3}([_-][A-Za-z0-9]{2,8})?$'),
  CONSTRAINT mood_boost_content_category_check CHECK (category IN (
    'isp_life','wifi_problems','customer_behaviour','mpesa_moments',
    'network_technicians','router_problems','internet_speed','business_life',
    'local_life','technology','trending_topics','weekend_humour'
  )),
  CONSTRAINT mood_boost_content_relevance_check CHECK (relevance_score BETWEEN 0 AND 1),
  CONSTRAINT mood_boost_content_status_check CHECK (moderation_status IN ('pending','approved','rejected')),
  CONSTRAINT mood_boost_content_caption_length_check CHECK (char_length(caption) BETWEEN 1 AND 500)
);

DROP INDEX IF EXISTS public.mood_boost_content_daily_topic_unique;
CREATE UNIQUE INDEX IF NOT EXISTS mood_boost_content_topic_language_unique
  ON public.mood_boost_content (source_topic_id, language)
  WHERE source_topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mood_boost_content_published_lookup
  ON public.mood_boost_content (country_code, language, category, published_at DESC)
  WHERE moderation_status = 'approved' AND campaign_enabled;
CREATE INDEX IF NOT EXISTS mood_boost_topics_active_lookup
  ON public.mood_boost_topics (country_code, language, status, discovered_at DESC);

CREATE TABLE IF NOT EXISTS public.mood_boost_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.mood_boost_content(id) ON DELETE CASCADE,
  feedback_type text NOT NULL,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mood_boost_feedback_type_check CHECK (
    feedback_type IN ('like','dislike','report','hide_category')
  ),
  CONSTRAINT mood_boost_feedback_tenant_user_content_unique UNIQUE (tenant_id,user_id,content_id)
);
CREATE INDEX IF NOT EXISTS mood_boost_feedback_reports_lookup
  ON public.mood_boost_feedback (created_at DESC)
  WHERE feedback_type = 'report';

CREATE TABLE IF NOT EXISTS public.mood_boost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.mood_boost_content(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mood_boost_history_tenant_user_content_unique UNIQUE (tenant_id,user_id,content_id)
);
CREATE INDEX IF NOT EXISTS mood_boost_history_recent_lookup
  ON public.mood_boost_history (tenant_id,user_id,viewed_at DESC);

CREATE TABLE IF NOT EXISTS public.mood_boost_user_preferences (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_categories text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,user_id),
  CONSTRAINT mood_boost_user_preferences_categories_check CHECK (hidden_categories <@ ARRAY[
    'isp_life','wifi_problems','customer_behaviour','mpesa_moments',
    'network_technicians','router_problems','internet_speed','business_life',
    'local_life','technology','trending_topics','weekend_humour'
  ]::text[])
);

CREATE TABLE IF NOT EXISTS public.mood_boost_platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  refresh_interval_hours integer NOT NULL DEFAULT 24,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mood_boost_platform_refresh_interval_check
    CHECK (refresh_interval_hours BETWEEN 24 AND 720)
);

ALTER TABLE public.mood_boost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_boost_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_boost_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_boost_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_boost_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_boost_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_boost_platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mood boost settings read by tenant" ON public.mood_boost_settings;
CREATE POLICY "mood boost settings read by tenant" ON public.mood_boost_settings
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid()) OR public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user','demo_viewer']::public.app_role[]
    )
  );
DROP POLICY IF EXISTS "mood boost settings insert by tenant admin" ON public.mood_boost_settings;
CREATE POLICY "mood boost settings insert by tenant admin" ON public.mood_boost_settings
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin(auth.uid()) OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
  );
DROP POLICY IF EXISTS "mood boost settings update by tenant admin" ON public.mood_boost_settings;
CREATE POLICY "mood boost settings update by tenant admin" ON public.mood_boost_settings
  FOR UPDATE TO authenticated USING (
    public.is_super_admin(auth.uid()) OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid()) OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
  );

DROP POLICY IF EXISTS "mood boost topics super admin access" ON public.mood_boost_topics;
CREATE POLICY "mood boost topics super admin access" ON public.mood_boost_topics
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "mood boost platform settings super admin access" ON public.mood_boost_platform_settings;
CREATE POLICY "mood boost platform settings super admin access" ON public.mood_boost_platform_settings
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "mood boost approved content read" ON public.mood_boost_content;
CREATE POLICY "mood boost approved content read" ON public.mood_boost_content
  FOR SELECT TO authenticated USING (
    moderation_status = 'approved' AND campaign_enabled
    AND published_at IS NOT NULL AND (expires_at IS NULL OR expires_at > now())
  );
DROP POLICY IF EXISTS "mood boost content super admin access" ON public.mood_boost_content;
CREATE POLICY "mood boost content super admin access" ON public.mood_boost_content
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "mood boost feedback self access" ON public.mood_boost_feedback;
CREATE POLICY "mood boost feedback self access" ON public.mood_boost_feedback
  FOR ALL TO authenticated USING (
    user_id = auth.uid() AND public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]
    )
  ) WITH CHECK (
    user_id = auth.uid() AND public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]
    ) AND EXISTS (
      SELECT 1 FROM public.mood_boost_content c
      WHERE c.id = content_id AND c.moderation_status = 'approved'
    )
  );
DROP POLICY IF EXISTS "mood boost feedback super admin read" ON public.mood_boost_feedback;
CREATE POLICY "mood boost feedback super admin read" ON public.mood_boost_feedback
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "mood boost history self access" ON public.mood_boost_history;
CREATE POLICY "mood boost history self access" ON public.mood_boost_history
  FOR ALL TO authenticated USING (
    user_id = auth.uid() AND public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]
    )
  ) WITH CHECK (
    user_id = auth.uid() AND public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]
    ) AND EXISTS (
      SELECT 1 FROM public.mood_boost_content c
      WHERE c.id = content_id AND c.moderation_status = 'approved'
    )
  );

DROP POLICY IF EXISTS "mood boost user preferences self access" ON public.mood_boost_user_preferences;
CREATE POLICY "mood boost user preferences self access" ON public.mood_boost_user_preferences
  FOR ALL TO authenticated USING (
    user_id = auth.uid() AND public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]
    )
  ) WITH CHECK (
    user_id = auth.uid() AND public.has_tenant_role(
      auth.uid(), tenant_id,
      ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]
    )
  );

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mood_boost_settings','mood_boost_topics','mood_boost_content',
    'mood_boost_feedback','mood_boost_history','mood_boost_user_preferences',
    'mood_boost_platform_settings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s require aal2" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s require aal2" ON public.%1$I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.is_aal2()) WITH CHECK (public.is_aal2())', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.mood_boost_settings,
  public.mood_boost_topics,
  public.mood_boost_content,
  public.mood_boost_feedback,
  public.mood_boost_history,
  public.mood_boost_user_preferences,
  public.mood_boost_platform_settings
TO authenticated;
GRANT ALL ON
  public.mood_boost_settings,
  public.mood_boost_topics,
  public.mood_boost_content,
  public.mood_boost_feedback,
  public.mood_boost_history,
  public.mood_boost_user_preferences,
  public.mood_boost_platform_settings
TO service_role;

INSERT INTO public.mood_boost_platform_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mood_boost_content (
  country_code, language, category, caption, original_caption,
  relevance_score, moderation_status, campaign_tag, created_at, published_at
)
SELECT seed.country_code, seed.language, seed.category, seed.caption, seed.original_caption,
       0.500, 'approved', 'evergreen-isp', now(), now()
FROM (VALUES
  ('KE','en','customer_behaviour','Customer: “The Wi-Fi is slow.” Also customer: 11 devices connected and all streaming in HD.',NULL),
  ('KE','sw','router_problems','Router imeomba chai kidogo. Hata yenyewe inahitaji break baada ya kuunganisha nyumba nzima.',NULL),
  ('KE','en','network_technicians','Technician: “Have you tried turning it off and on?” Router: “We have discussed this.”',NULL),
  ('KE','sw','internet_speed','Internet iko fast leo mpaka page imefika kabla hujabonyeza refresh.',NULL),
  ('TZ','sw','wifi_problems','Wi-Fi ikikataa, kila mtu anakuwa mtaalamu wa router kwa dakika moja.',NULL),
  ('TZ','en','business_life','A good ISP day: the network is quiet, the dashboard is calm, and the tea is still hot.',NULL),
  ('TZ','sw','network_technicians','Fundi akifika, router inawaka vizuri kama ilikuwa inangoja tu kuonyeshwa.',NULL),
  ('TZ','en','router_problems','The router did not disappear. It is just taking a very important five-minute reboot.',NULL),
  ('UG','en','customer_behaviour','“Just one quick download,” they said. The progress bar is now part of the family.',NULL),
  ('UG','en','network_technicians','Network technician status: one hand on the cable, one eye on the dashboard, tea within reach.',NULL),
  ('UG','en','wifi_problems','When the Wi-Fi comes back, the whole house reconnects before anyone says thank you.',NULL),
  ('UG','en','business_life','Small ISP win: the router is online, the customers are happy, and nobody has asked for the password twice.',NULL),
  ('ZZ','en','isp_life','The router is not ignoring you. It is thinking about your request very carefully.',NULL),
  ('ZZ','en','wifi_problems','Wi-Fi is the only team member expected to work in every room at once.',NULL),
  ('ZZ','sw','isp_life','Wi-Fi ni kama chai: kila mtu anaitaka, hasa ikikosekana.',NULL),
  ('ZZ','sw','network_technicians','Fundi akifika, vifaa vinaamua kufanya kazi kwa sababu ya heshima.',NULL),
  ('ZZ','lg','isp_life','Wi-Fi bw’egenda, buli muntu afuuka engineer mu kaseera katono.',NULL)
) AS seed(country_code,language,category,caption,original_caption)
WHERE NOT EXISTS (
  SELECT 1 FROM public.mood_boost_content existing
  WHERE existing.country_code = seed.country_code
    AND existing.language = seed.language
    AND existing.caption = seed.caption
);
