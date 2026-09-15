CREATE TABLE "work_tasks" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "attachments" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "checkpoint" JSONB,
  "progress" JSONB NOT NULL DEFAULT '[]',
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "user_message_id" TEXT,
  "ai_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "work_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "work_tasks_user_id_request_key_key" ON "work_tasks"("user_id", "request_key");
CREATE INDEX "work_tasks_user_id_created_at_idx" ON "work_tasks"("user_id", "created_at");
CREATE INDEX "work_tasks_status_lease_expires_at_idx" ON "work_tasks"("status", "lease_expires_at");
-- 多进程也不能为同一用户并行启动两个后台任务。
CREATE UNIQUE INDEX "work_tasks_one_active_user" ON "work_tasks"("user_id") WHERE "status" IN ('queued', 'running', 'paused');
