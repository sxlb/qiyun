ALTER TABLE "UpdateRecord" ADD COLUMN "estimatedSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UpdateRecord" ADD COLUMN "durationSeconds" INTEGER;
