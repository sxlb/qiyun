-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "customFontEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Profile" ADD COLUMN "customFontFamily" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "customFontScope" TEXT NOT NULL DEFAULT 'nickname';
