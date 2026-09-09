-- 聊天图片消息：照片落盘 data/chat-images，行内只记扩展名。

ALTER TABLE "messages" ADD COLUMN "image_ext" TEXT;
