-- Add cached image path columns to profiles.
ALTER TABLE profiles ADD COLUMN avatar_cached TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN banner_cached TEXT NOT NULL DEFAULT '';
