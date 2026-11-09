-- AlterTable
ALTER TABLE "StudyQuestion" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "notionId" TEXT;

-- CreateTable
CREATE TABLE "StudyNotion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sourcePage" INTEGER,

    CONSTRAINT "StudyNotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyNotion_courseId_missionId_position_idx" ON "StudyNotion"("courseId", "missionId", "position");

-- AddForeignKey
ALTER TABLE "StudyNotion" ADD CONSTRAINT "StudyNotion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "StudyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyQuestion" ADD CONSTRAINT "StudyQuestion_notionId_fkey" FOREIGN KEY ("notionId") REFERENCES "StudyNotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
