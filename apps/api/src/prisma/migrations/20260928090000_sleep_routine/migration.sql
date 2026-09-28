-- 路线图 C28：日程页的睡眠卡。晚安提醒与早安闹钟仍是「安排」，只多一列区分；旧数据都是日程里的一件事。
ALTER TABLE "scheduled_reminders" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'plain';
