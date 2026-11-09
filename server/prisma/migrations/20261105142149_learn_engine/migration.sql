-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "stars" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "bestStreak" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "victory" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "unassisted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyQuestionState" (
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lastCorrect" BOOLEAN NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyQuestionState_pkey" PRIMARY KEY ("studentId","questionId")
);

-- CreateTable
CREATE TABLE "StudyMissionResult" (
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "bestStars" INTEGER NOT NULL DEFAULT 0,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyMissionResult_pkey" PRIMARY KEY ("studentId","courseId","missionId")
);

-- CreateIndex
CREATE INDEX "StudySession_studentId_createdAt_idx" ON "StudySession"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "StudySession_courseId_idx" ON "StudySession"("courseId");

-- CreateIndex
CREATE INDEX "StudyAttempt_studentId_questionId_createdAt_idx" ON "StudyAttempt"("studentId", "questionId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyQuestionState_studentId_dueAt_idx" ON "StudyQuestionState"("studentId", "dueAt");

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "StudyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyAttempt" ADD CONSTRAINT "StudyAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyAttempt" ADD CONSTRAINT "StudyAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "StudyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyQuestionState" ADD CONSTRAINT "StudyQuestionState_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyQuestionState" ADD CONSTRAINT "StudyQuestionState_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "StudyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMissionResult" ADD CONSTRAINT "StudyMissionResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMissionResult" ADD CONSTRAINT "StudyMissionResult_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "StudyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
