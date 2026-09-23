-- 「做梦」：用户自己决定是否让她在后台回想对话、提出待确认的理解（默认关闭）；dreamt_at 为上次回想时间，用于节流与并发领取。
ALTER TABLE "users" ADD COLUMN "dream_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "dreamt_at" TIMESTAMP(3);
