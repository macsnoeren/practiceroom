-- AlterTable
ALTER TABLE "Recording" ADD COLUMN "layoutPosition" TEXT;
ALTER TABLE "Recording" ADD COLUMN "layoutRole" TEXT;
ALTER TABLE "Recording" ADD COLUMN "layoutScale" REAL;

-- CreateTable
CREATE TABLE "ComposedSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComposedSource_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComposedSource_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComposedSourceMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "position" TEXT,
    "scale" REAL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ComposedSourceMember_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ComposedSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComposedSourceMember_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ComposedSource_schoolId_idx" ON "ComposedSource"("schoolId");

-- CreateIndex
CREATE INDEX "ComposedSource_roomId_idx" ON "ComposedSource"("roomId");

-- CreateIndex
CREATE INDEX "ComposedSourceMember_sourceId_idx" ON "ComposedSourceMember"("sourceId");

-- CreateIndex
CREATE INDEX "ComposedSourceMember_deviceId_idx" ON "ComposedSourceMember"("deviceId");
