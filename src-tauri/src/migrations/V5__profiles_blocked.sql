-- Add local DM block list column to profiles.
ALTER TABLE profiles ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
