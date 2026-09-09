-- 她的工作台（派生理解层）：AI 自由推演，人类定典；非记忆，可整层清空。

CREATE TABLE "derived_insights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "evidence" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'active',
    "promoted_memory_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "derived_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "derived_insights_user_id_status_idx" ON "derived_insights"("user_id", "status");

ALTER TABLE "derived_insights" ADD CONSTRAINT "derived_insights_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
