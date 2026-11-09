-- CreateEnum
CREATE TYPE "StudyStatus" AS ENUM ('EXTRACTING', 'ANALYSING', 'CREATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "StudyCourse" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "title" TEXT,
    "status" "StudyStatus" NOT NULL DEFAULT 'EXTRACTING',
    "error" TEXT,
    "analysis" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyQuestion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "answerIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "sourcePage" INTEGER,
    "sourceExcerpt" TEXT NOT NULL,

    CONSTRAINT "StudyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyCourse_studentId_createdAt_idx" ON "StudyCourse"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyQuestion_courseId_position_idx" ON "StudyQuestion"("courseId", "position");

-- AddForeignKey
ALTER TABLE "StudyCourse" ADD CONSTRAINT "StudyCourse_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyQuestion" ADD CONSTRAINT "StudyQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "StudyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
