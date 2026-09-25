-- 路线图 C23 第四步：记忆与她的书的段落，向量合进一张表 embeddings（派生索引）。
-- 旧的 memory_projections、book_passages.vector 保留只读、不再有写入方；新表由补算任务用本机向量服务重算（不花钱），不在 SQL 里转换旧身份。

-- CreateTable
CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "subject_version" TEXT NOT NULL,
    "identity_key" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "embeddings_user_id_subject_type_identity_key_idx" ON "embeddings"("user_id", "subject_type", "identity_key");

-- CreateIndex
CREATE INDEX "embeddings_subject_type_parent_id_idx" ON "embeddings"("subject_type", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "embeddings_subject_type_subject_id_identity_key_key" ON "embeddings"("subject_type", "subject_id", "identity_key");

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

