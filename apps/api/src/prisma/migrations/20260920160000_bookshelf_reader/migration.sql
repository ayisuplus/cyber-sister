-- 书架与伴读：书本身留在用户自己的浏览器里，这里只记她在读什么、读到哪儿。
-- format 为空表示聊天里随口记下的纸书；locator 是前端给的进度串，服务端只存不解析。
ALTER TABLE "books" ADD COLUMN "format" TEXT;
ALTER TABLE "books" ADD COLUMN "file_name" TEXT;
ALTER TABLE "books" ADD COLUMN "locator" TEXT;
ALTER TABLE "books" ADD COLUMN "percent" INTEGER;

-- 笔记记下当时选中的那段原文与位置，回头能翻回去。
ALTER TABLE "reading_notes" ADD COLUMN "quote" TEXT;
ALTER TABLE "reading_notes" ADD COLUMN "locator" TEXT;
