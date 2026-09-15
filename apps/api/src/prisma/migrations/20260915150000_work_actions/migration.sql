CREATE TABLE "work_actions" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "decided_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "http_status" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_actions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "work_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "work_actions_task_id_status_idx" ON "work_actions"("task_id", "status");
