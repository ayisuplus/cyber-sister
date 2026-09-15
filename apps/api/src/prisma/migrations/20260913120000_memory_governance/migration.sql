ALTER TABLE "memories" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sources" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "portable_id" TEXT;
UPDATE "memories" SET "portable_id" = "id";
ALTER TABLE "memories" ALTER COLUMN "portable_id" SET NOT NULL;
CREATE UNIQUE INDEX "memories_user_id_portable_id_key" ON "memories"("user_id", "portable_id");

ALTER TABLE "derived_insights" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sources" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "source_memory_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "memory_edges" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "from_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "to_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "decisions" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "memory_revisions" (
  "id" TEXT NOT NULL, "memory_id" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "type" TEXT NOT NULL, "content" TEXT NOT NULL, "importance" INTEGER NOT NULL,
  "tags" TEXT, "expires_at" TIMESTAMP(3), "origin" TEXT NOT NULL,
  "sources" JSONB NOT NULL DEFAULT '[]', "action" TEXT NOT NULL,
  "restored_from" INTEGER, "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_revisions_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "memory_revisions_memory_id_revision_key" ON "memory_revisions"("memory_id", "revision");
-- 基线只能证明迁移时的状态，不能补造历史确认时间或来源证据。
INSERT INTO "memory_revisions" ("id", "memory_id", "revision", "type", "content", "importance", "tags", "expires_at", "origin", "action")
SELECT 'baseline-' || "id", "id", 1, "type", "content", "importance", "tags", "expires_at", "origin", 'baseline' FROM "memories";

CREATE TABLE "memory_projections" (
  "memory_id" TEXT NOT NULL, "memory_revision" INTEGER NOT NULL, "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL, "dimensions" INTEGER NOT NULL, "rule_version" INTEGER NOT NULL DEFAULT 1,
  "vector" DOUBLE PRECISION[] NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "memory_projections_pkey" PRIMARY KEY ("memory_id"),
  CONSTRAINT "memory_projections_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "memory_index_jobs" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "mode" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "total" INTEGER NOT NULL DEFAULT 0, "processed" INTEGER NOT NULL DEFAULT 0,
  "embedded" INTEGER NOT NULL DEFAULT 0, "skipped" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "memory_index_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_index_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "memory_index_jobs_user_id_created_at_idx" ON "memory_index_jobs"("user_id", "created_at");
-- 多进程也不能为同一用户同时创建两个活跃任务。
CREATE UNIQUE INDEX "memory_index_jobs_one_active" ON "memory_index_jobs"("user_id") WHERE "status" IN ('queued', 'running');
