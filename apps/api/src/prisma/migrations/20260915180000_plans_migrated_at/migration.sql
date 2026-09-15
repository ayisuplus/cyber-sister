-- 功能收拢：日程/倒数日/习惯/旧提醒迁为「安排」（定时任务）的按用户幂等标记；旧表只停用、不删除。
ALTER TABLE "users" ADD COLUMN "plans_migrated_at" TIMESTAMP(3);
