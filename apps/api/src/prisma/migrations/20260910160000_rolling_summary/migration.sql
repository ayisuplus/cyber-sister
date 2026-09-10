-- 滚动摘要：会话级前情摘要，覆盖 summary_up_to_at 之前的消息

ALTER TABLE "conversations" ADD COLUMN "summary" TEXT;
ALTER TABLE "conversations" ADD COLUMN "summary_up_to_at" TIMESTAMP(3);
