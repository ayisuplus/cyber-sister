-- 路线图 C23 第五步：退役旧的记忆表与列（产品负责人 2026-09-26 批准提前到本周期）。
-- 关系、理解草稿、惦记的事已在 20260925150000_inferences 搬进 inferences；向量改存 embeddings（派生物，补算任务会重算）。
-- 执行前核对过：这几张表自那次迁移起没有写入方；删之前另做了 pg_dump 备份。memory_index_jobs 仍是补算任务的表，保留。

-- DropForeignKey
ALTER TABLE "memory_edges" DROP CONSTRAINT "memory_edges_user_id_fkey";

-- DropForeignKey
ALTER TABLE "memory_edges" DROP CONSTRAINT "memory_edges_from_memory_id_fkey";

-- DropForeignKey
ALTER TABLE "memory_edges" DROP CONSTRAINT "memory_edges_to_memory_id_fkey";

-- DropForeignKey
ALTER TABLE "derived_insights" DROP CONSTRAINT "derived_insights_user_id_fkey";

-- DropForeignKey
ALTER TABLE "memory_projections" DROP CONSTRAINT "memory_projections_memory_id_fkey";

-- DropForeignKey
ALTER TABLE "follow_ups" DROP CONSTRAINT "follow_ups_user_id_fkey";

-- AlterTable
ALTER TABLE "memories" DROP COLUMN "embedding",
DROP COLUMN "embedding_model",
DROP COLUMN "entities";

-- AlterTable
ALTER TABLE "book_passages" DROP COLUMN "vector";

-- DropTable
DROP TABLE "memory_edges";

-- DropTable
DROP TABLE "derived_insights";

-- DropTable
DROP TABLE "memory_projections";

-- DropTable
DROP TABLE "follow_ups";
