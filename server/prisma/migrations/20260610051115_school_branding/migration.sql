-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_School" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overlayText" TEXT,
    "introMimeType" TEXT,
    "introSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "outroMimeType" TEXT,
    "outroSizeBytes" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_School" ("createdAt", "id", "name") SELECT "createdAt", "id", "name" FROM "School";
DROP TABLE "School";
ALTER TABLE "new_School" RENAME TO "School";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
