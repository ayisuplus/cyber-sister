-- 她的来信：按用户设定的频率（3/7 天）由服务器端根据记忆书写；「做梦」与「待确认」收进信里，不再摆到台面上。
-- users：写信频率取代做梦开关（存量默认不写信，与「做梦默认关」同口径）。
ALTER TABLE "users" ADD COLUMN "letter_freq_days" INTEGER;
ALTER TABLE "users" DROP COLUMN "dream_enabled";
ALTER TABLE "users" DROP COLUMN "dreamt_at";

-- letters：周起始改名为周期起点；记录这封信按几天一封生成，并带上可一键采纳的建议。
ALTER TABLE "letters" RENAME COLUMN "week_start" TO "period_start";
ALTER TABLE "letters" ADD COLUMN "freq_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "letters" ADD COLUMN "suggestions" JSONB NOT NULL DEFAULT '[]';
DROP INDEX "letters_user_id_week_start_key";
CREATE UNIQUE INDEX "letters_user_id_period_start_key" ON "letters"("user_id", "period_start");
