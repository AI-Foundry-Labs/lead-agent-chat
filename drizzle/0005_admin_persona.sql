-- Add persona field to admins for bot-admin interaction personalisation.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "persona" text;
