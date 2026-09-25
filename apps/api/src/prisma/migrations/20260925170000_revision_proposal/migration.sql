-- 路线图 C23 提议通道：记忆的每一版记下它是采纳了哪封信的哪条建议写下的（来源链）。
-- AlterTable
ALTER TABLE "memory_revisions" ADD COLUMN "proposal" JSONB;
