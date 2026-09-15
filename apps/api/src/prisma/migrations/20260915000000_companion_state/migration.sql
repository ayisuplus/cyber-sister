-- 独立于用户正式 Memory 的角色模拟状态；既有用户惰性初始化，不重写个人资料。
ALTER TABLE "users" ADD COLUMN "companion_state" JSONB,
  ADD COLUMN "companion_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "messages" ADD COLUMN "companion_experience" JSONB;
