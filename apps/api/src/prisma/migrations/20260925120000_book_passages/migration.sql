-- 书架合并（路线图 C22）：她可以把自己的书上传给 Amie，聊天时和内置书一起翻；回答里提不提书名单独一个开关。
-- users：「回答里提到书」默认关（存量用户同样不提）。
ALTER TABLE "users" ADD COLUMN "cite_books" BOOLEAN NOT NULL DEFAULT false;

-- books：没选上传的书三列都是 NULL，照旧只在她的设备上。
ALTER TABLE "books" ADD COLUMN "server_index" TEXT;
ALTER TABLE "books" ADD COLUMN "index_identity" JSONB;
ALTER TABLE "books" ADD COLUMN "indexed_at" TIMESTAMP(3);

-- book_passages：上传的书切成的段和向量；撤回上传、删书、注销账号都跟着删。
CREATE TABLE "book_passages" (
  "id" TEXT NOT NULL, "book_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "seq" INTEGER NOT NULL,
  "chapter_index" INTEGER NOT NULL, "chapter" TEXT, "locator" TEXT NOT NULL, "content" TEXT NOT NULL,
  "vector" DOUBLE PRECISION[], "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_passages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "book_passages_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "book_passages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "book_passages_user_id_idx" ON "book_passages"("user_id");
CREATE INDEX "book_passages_book_id_seq_idx" ON "book_passages"("book_id", "seq");
