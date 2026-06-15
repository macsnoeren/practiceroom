-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'camera',
    "roomId" TEXT,
    "isAudioSource" BOOLEAN NOT NULL DEFAULT false,
    "videoOffsetMs" INTEGER NOT NULL DEFAULT 0,
    "pairingCode" TEXT,
    "pairingExpiresAt" DATETIME,
    "tokenHash" TEXT,
    "pairedAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Device_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("createdAt", "id", "isAudioSource", "kind", "lastSeenAt", "name", "pairedAt", "pairingCode", "pairingExpiresAt", "roomId", "schoolId", "tokenHash") SELECT "createdAt", "id", "isAudioSource", "kind", "lastSeenAt", "name", "pairedAt", "pairingCode", "pairingExpiresAt", "roomId", "schoolId", "tokenHash" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_pairingCode_key" ON "Device"("pairingCode");
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");
CREATE INDEX "Device_schoolId_idx" ON "Device"("schoolId");
CREATE INDEX "Device_roomId_idx" ON "Device"("roomId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
