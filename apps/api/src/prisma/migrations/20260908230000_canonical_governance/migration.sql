-- 共生知识库 M1：定典治理闭环。记忆记录来源与权威；工作台冲突条目支持厘清定稿。

ALTER TABLE "memories" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "memories" ADD COLUMN "source_ref" TEXT;
ALTER TABLE "derived_insights" ADD COLUMN "resolution" TEXT;
