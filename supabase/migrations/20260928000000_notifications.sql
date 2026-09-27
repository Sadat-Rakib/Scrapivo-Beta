-- Notifications (Workstream 6) — channel connections, durable outbox, in-app feed.
--
-- notification_connections: per-user channel endpoints (in_app needs no row;
-- email/slack do). Credentials are AES-256-GCM encrypted at rest
-- (src/lib/notifications/crypto.server.ts, key = SCRAPIVO_NOTIFICATIONS_KEY)
-- and are NEVER returned to clients — server fns project only
-- {id, type, display_name, enabled}.
--
-- notification_outbox: the single durable intent log. One row per
-- idempotency_key (UNIQUE + ON CONFLICT DO NOTHING), so retries and duplicate
-- watch completions can never double-notify. Writes are service-side only
-- (no INSERT/UPDATE policy for authenticated); users read their own rows.
--
-- in_app_notifications: the in-app channel's delivery target, user-owned.

-- =========================================================================
-- 1. notification_connections
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.notification_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  project_id            UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  type                  TEXT NOT NULL CHECK (type IN ('in_app','email','slack')),
  encrypted_credentials TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_connections_user
  ON public.notification_connections (user_id, type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_connections TO authenticated;
GRANT ALL ON public.notification_connections TO service_role;

ALTER TABLE public.notification_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_connections_select_own" ON public.notification_connections;
CREATE POLICY "notification_connections_select_own" ON public.notification_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notification_connections_insert_own" ON public.notification_connections;
CREATE POLICY "notification_connections_insert_own" ON public.notification_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notification_connections_update_own" ON public.notification_connections;
CREATE POLICY "notification_connections_update_own" ON public.notification_connections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notification_connections_delete_own" ON public.notification_connections;
CREATE POLICY "notification_connections_delete_own" ON public.notification_connections
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =========================================================================
-- 2. notification_outbox
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT NOT NULL UNIQUE,
  user_id          UUID NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('in_app','email','slack')),
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sending','delivered','delivery_unknown','failed')),
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim loop: pending rows past available_at with attempts left.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_claim
  ON public.notification_outbox (status, available_at)
  WHERE status IN ('pending','failed');

GRANT SELECT ON public.notification_outbox TO authenticated;
GRANT ALL ON public.notification_outbox TO service_role;

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_outbox_select_own" ON public.notification_outbox;
CREATE POLICY "notification_outbox_select_own" ON public.notification_outbox
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies: the outbox is service-written only.

-- =========================================================================
-- 3. in_app_notifications
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  payload    JSONB NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user
  ON public.in_app_notifications (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.in_app_notifications TO authenticated;
GRANT ALL ON public.in_app_notifications TO service_role;

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "in_app_notifications_select_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_select_own" ON public.in_app_notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "in_app_notifications_insert_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_insert_own" ON public.in_app_notifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "in_app_notifications_update_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_update_own" ON public.in_app_notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "in_app_notifications_delete_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_delete_own" ON public.in_app_notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
