-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ComposedSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audioDeviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComposedSource_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComposedSource_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComposedSource_audioDeviceId_fkey" FOREIGN KEY ("audioDeviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ComposedSource" ("createdAt", "id", "name", "roomId", "schoolId") SELECT "createdAt", "id", "name", "roomId", "schoolId" FROM "ComposedSource";
DROP TABLE "ComposedSource";
ALTER TABLE "new_ComposedSource" RENAME TO "ComposedSource";
CREATE INDEX "ComposedSource_schoolId_idx" ON "ComposedSource"("schoolId");
CREATE INDEX "ComposedSource_roomId_idx" ON "ComposedSource"("roomId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
