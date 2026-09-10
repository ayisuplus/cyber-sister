-- 定时任务：scheduled_reminders 加 instruction（有指令即任务）；reminder_deliveries 加 result 承载执行产出

ALTER TABLE "scheduled_reminders" ADD COLUMN "instruction" TEXT;
ALTER TABLE "reminder_deliveries" ADD COLUMN "result" TEXT;
