-- 共生知识库 M2：记忆语义向量投影 + 记忆关系边（派生/定典双层）。

ALTER TABLE "memories" ADD COLUMN "embedding" DOUBLE PRECISION[];
ALTER TABLE "memories" ADD COLUMN "embedding_model" TEXT;

CREATE TABLE "memory_edges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_memory_id" TEXT NOT NULL,
    "to_memory_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'derived',
    "evidence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memory_edges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memory_edges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memory_edges_from_memory_id_fkey" FOREIGN KEY ("from_memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memory_edges_to_memory_id_fkey" FOREIGN KEY ("to_memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "memory_edges_user_id_status_idx" ON "memory_edges"("user_id", "status");
