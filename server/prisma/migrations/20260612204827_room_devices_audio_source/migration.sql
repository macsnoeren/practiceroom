-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roomId" TEXT,
    "isAudioSource" BOOLEAN NOT NULL DEFAULT false,
    "pairingCode" TEXT,
    "pairingExpiresAt" DATETIME,
    "tokenHash" TEXT,
    "pairedAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Device_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("createdAt", "id", "lastSeenAt", "name", "pairedAt", "pairingCode", "pairingExpiresAt", "schoolId", "tokenHash") SELECT "createdAt", "id", "lastSeenAt", "name", "pairedAt", "pairingCode", "pairingExpiresAt", "schoolId", "tokenHash" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_pairingCode_key" ON "Device"("pairingCode");
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");
CREATE INDEX "Device_schoolId_idx" ON "Device"("schoolId");
CREATE INDEX "Device_roomId_idx" ON "Device"("roomId");
CREATE TABLE "new_Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recording',
    "mimeType" TEXT,
    "hasVideo" BOOLEAN NOT NULL DEFAULT true,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "cropX" REAL,
    "cropY" REAL,
    "cropW" REAL,
    "cropH" REAL,
    "receivedChunks" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "segmentGroupId" TEXT,
    "isAudioTrack" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Recording_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recording_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Recording" ("completedAt", "cropH", "cropW", "cropX", "cropY", "deviceId", "hasAudio", "hasVideo", "id", "lessonId", "mimeType", "receivedChunks", "sizeBytes", "startedAt", "status") SELECT "completedAt", "cropH", "cropW", "cropX", "cropY", "deviceId", "hasAudio", "hasVideo", "id", "lessonId", "mimeType", "receivedChunks", "sizeBytes", "startedAt", "status" FROM "Recording";
DROP TABLE "Recording";
ALTER TABLE "new_Recording" RENAME TO "Recording";
CREATE INDEX "Recording_lessonId_idx" ON "Recording"("lessonId");
CREATE INDEX "Recording_deviceId_idx" ON "Recording"("deviceId");
CREATE INDEX "Recording_segmentGroupId_idx" ON "Recording"("segmentGroupId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
