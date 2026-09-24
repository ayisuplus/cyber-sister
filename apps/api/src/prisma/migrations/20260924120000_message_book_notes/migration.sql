-- 页边铅笔批注：AI 消息记下她写这一段时翻过的书（书名、章、用途与边界的快照）。
-- 纯增量可空列，历史消息与没翻书的轮次为 NULL。
ALTER TABLE "messages" ADD COLUMN "book_notes" JSONB;
