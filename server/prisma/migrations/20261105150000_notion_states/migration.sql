-- DropForeignKey
ALTER TABLE "StudyQuestionState" DROP CONSTRAINT "StudyQuestionState_questionId_fkey";

-- DropForeignKey
ALTER TABLE "StudyQuestionState" DROP CONSTRAINT "StudyQuestionState_studentId_fkey";

-- DropTable
DROP TABLE "StudyQuestionState";

-- CreateTable
CREATE TABLE "StudyNotionState" (
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "notionKey" TEXT NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lastCorrect" BOOLEAN NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyNotionState_pkey" PRIMARY KEY ("studentId","notionKey")
);

-- CreateIndex
CREATE INDEX "StudyNotionState_studentId_dueAt_idx" ON "StudyNotionState"("studentId", "dueAt");

-- AddForeignKey
ALTER TABLE "StudyNotionState" ADD CONSTRAINT "StudyNotionState_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyNotionState" ADD CONSTRAINT "StudyNotionState_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "StudyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

