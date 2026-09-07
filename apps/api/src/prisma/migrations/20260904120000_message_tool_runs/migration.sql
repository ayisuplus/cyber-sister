-- 智能体工具回路：AI 消息可携带当轮工具执行摘要（动作标签）。
-- 纯增量可空列，历史消息为 NULL（未使用工具的轮次也是 NULL）。
ALTER TABLE "messages" ADD COLUMN "tool_runs" JSONB;
