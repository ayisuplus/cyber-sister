-- 经期记录单独同意（敏感个人信息）：同意时间；撤回置空。
ALTER TABLE "users" ADD COLUMN "period_consent_at" TIMESTAMP(3);
