-- 日记与手帐（习惯打卡）：纯增量三张表。
-- 日期契约沿用经期/倒数日：'yyyy-MM-dd' 按 UTC 零点存储，前端按本地日历日解析比较。

CREATE TABLE "diary_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "mood" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "ai_comment" TEXT,
    "ai_comment_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diary_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diary_entries_user_id_day_key" ON "diary_entries"("user_id", "day");
CREATE INDEX "diary_entries_user_id_day_idx" ON "diary_entries"("user_id", "day");

ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "habits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "habits_user_id_idx" ON "habits"("user_id");

ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "habit_checkins" (
    "id" TEXT NOT NULL,
    "habit_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "habit_checkins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "habit_checkins_habit_id_day_key" ON "habit_checkins"("habit_id", "day");
CREATE INDEX "habit_checkins_user_id_day_idx" ON "habit_checkins"("user_id", "day");

ALTER TABLE "habit_checkins" ADD CONSTRAINT "habit_checkins_habit_id_fkey"
    FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
