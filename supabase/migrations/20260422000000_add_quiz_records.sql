-- Quiz records table and mastery_score column
CREATE TABLE IF NOT EXISTS public.quiz_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  is_correct boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_records_node_owner ON public.quiz_records(node_id, owner_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_records_owner ON public.quiz_records(owner_id);

ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS mastery_score real NOT NULL DEFAULT 0;

ALTER TABLE public.quiz_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY quiz_records_owner ON public.quiz_records
  FOR ALL USING (owner_id = auth.uid());
