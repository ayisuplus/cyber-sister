ALTER TABLE "users" ADD COLUMN "memory_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "memories" ADD COLUMN "imported_at" TIMESTAMP(3);
ALTER TABLE "memory_revisions" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;
