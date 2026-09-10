-- 自定义定时提醒：ScheduledReminder（提醒定义）+ ReminderDelivery（到点投递实例，幂等）

CREATE TABLE "scheduled_reminders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "freq" TEXT NOT NULL DEFAULT 'once',
    "time" TEXT,
    "fire_at" TIMESTAMP(3),
    "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "month_day" INTEGER,
    "next_fire_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scheduled_reminders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduled_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "scheduled_reminders_user_id_status_next_fire_at_idx" ON "scheduled_reminders"("user_id", "status", "next_fire_at");

CREATE TABLE "reminder_deliveries" (
    "id" TEXT NOT NULL,
    "reminder_id" TEXT NOT NULL,
    "fire_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reminder_deliveries_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "scheduled_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reminder_deliveries_reminder_id_fire_at_key" ON "reminder_deliveries"("reminder_id", "fire_at");
