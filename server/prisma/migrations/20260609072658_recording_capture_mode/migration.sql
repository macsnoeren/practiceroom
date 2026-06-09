-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recording',
    "mimeType" TEXT,
    "hasVideo" BOOLEAN NOT NULL DEFAULT true,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "receivedChunks" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Recording_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recording_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Recording" ("completedAt", "deviceId", "id", "lessonId", "mimeType", "receivedChunks", "sizeBytes", "startedAt", "status") SELECT "completedAt", "deviceId", "id", "lessonId", "mimeType", "receivedChunks", "sizeBytes", "startedAt", "status" FROM "Recording";
DROP TABLE "Recording";
ALTER TABLE "new_Recording" RENAME TO "Recording";
CREATE INDEX "Recording_lessonId_idx" ON "Recording"("lessonId");
CREATE INDEX "Recording_deviceId_idx" ON "Recording"("deviceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
