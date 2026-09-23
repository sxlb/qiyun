-- Add the admin command palette toggle required by the Prisma schema.
-- Without this migration, Profile reads fail when the column is missing.
ALTER TABLE "Profile" ADD COLUMN "commandPalette" INTEGER NOT NULL DEFAULT 1;
