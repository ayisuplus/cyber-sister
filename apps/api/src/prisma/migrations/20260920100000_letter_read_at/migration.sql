-- 她的信改为在对话里说：读过就标记，不再重复出现。
ALTER TABLE "letters" ADD COLUMN "read_at" TIMESTAMP(3);
