-- AlterTable
ALTER TABLE "StudyCourse" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runAfter" TIMESTAMP(3),
ADD COLUMN     "sourceText" JSONB,
ADD COLUMN     "step" TEXT,
ADD COLUMN     "unit" TEXT,
ALTER COLUMN "status" SET DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "StudyQuestion" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;
