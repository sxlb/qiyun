-- Add the music player mode column required by the Prisma schema.
ALTER TABLE "Profile" ADD COLUMN "musicPlayerMode" TEXT NOT NULL DEFAULT 'card';
