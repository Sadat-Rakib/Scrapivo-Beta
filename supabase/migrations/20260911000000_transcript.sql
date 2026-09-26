-- Conversation transcripts (Step 3): every turn's inputs + frozen outputs.
--
-- One row per conversation (upserted by conversation_id as turns complete).
-- transcript JSONB mirrors the Discover ConversationTurn type 1:1:
--   [{ id, text, results?: { leads, companies, people, local }, ts }]
-- Capped at 50 turns per conversation (sanitized before save; byte-capped
-- server-side, newest turns survive). Only New chat starts a new
-- conversation; history rows are never deleted by the app.
-- RLS: inherits the existing search_history owner policy
-- (auth.uid() = user_id); server code additionally scopes every
-- delete/get by user_id (defense in depth, since conversation ids alone
-- must never authorize access).

ALTER TABLE public.search_history
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS transcript JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'search_history_conversation_key'
  ) THEN
    ALTER TABLE public.search_history
      ADD CONSTRAINT search_history_conversation_key UNIQUE (conversation_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS search_history_conversation_idx
  ON public.search_history (conversation_id);
CREATE INDEX IF NOT EXISTS search_history_user_created_idx
  ON public.search_history (user_id, created_at DESC);
