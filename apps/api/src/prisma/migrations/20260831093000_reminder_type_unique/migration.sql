-- 提醒：每用户每类型仅一条，支撑默认提醒的并发安全 upsert。
-- 旧的 user_id 前缀索引被唯一约束覆盖，一并删除。
DROP INDEX "reminders_user_id_idx";

CREATE UNIQUE INDEX "reminders_user_id_type_key" ON "reminders"("user_id", "type");
