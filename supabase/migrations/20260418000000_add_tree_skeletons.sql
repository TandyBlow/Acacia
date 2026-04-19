-- Create tree_skeletons table for storing L-system generated tree visualizations
CREATE TABLE tree_skeletons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skeleton_data jsonb NOT NULL,
  png_url text,
  created_at timestamptz DEFAULT now()
);

-- Create index on owner_id for faster queries
CREATE INDEX idx_tree_skeletons_owner_id ON tree_skeletons(owner_id);

-- Enable RLS
ALTER TABLE tree_skeletons ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own skeletons
CREATE POLICY "Users can view own tree skeletons"
  ON tree_skeletons
  FOR SELECT
  USING (auth.uid() = owner_id);

-- Policy: Users can insert their own skeletons
CREATE POLICY "Users can create own tree skeletons"
  ON tree_skeletons
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Policy: Users can delete their own skeletons
CREATE POLICY "Users can delete own tree skeletons"
  ON tree_skeletons
  FOR DELETE
  USING (auth.uid() = owner_id);
