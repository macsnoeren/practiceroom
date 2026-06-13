-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Membership_schoolId_idx" ON "Membership"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_schoolId_key" ON "Membership"("userId", "schoolId");

-- Data seed: every existing non-superadmin with a home school becomes a member
-- of that school with their current role. (hex(randomblob) is a unique id since
-- SQLite has no cuid().)
INSERT INTO "Membership" ("id", "userId", "schoolId", "role", "createdAt")
SELECT lower(hex(randomblob(16))), "id", "schoolId", "role", "createdAt"
FROM "User"
WHERE "role" <> 'superadmin' AND "schoolId" IS NOT NULL;
