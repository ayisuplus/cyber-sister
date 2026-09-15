ALTER TABLE "work_artifacts"
  ADD COLUMN "encoding" TEXT NOT NULL DEFAULT 'utf8',
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'generated';
