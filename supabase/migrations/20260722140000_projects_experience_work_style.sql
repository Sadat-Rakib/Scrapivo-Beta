-- Fix schema drift: projects may have been created before experience_level / work_style existed.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS experience_level text NOT NULL DEFAULT '0-1';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS work_style text NOT NULL DEFAULT 'remote';

-- Audience now also accepts 'all' (stored as free text).
COMMENT ON COLUMN public.projects.audience IS 'companies | agencies | people | all';
