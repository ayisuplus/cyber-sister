-- 功能收拢：新用户默认说话方式由「毒舌」改为「温柔」；只改默认值，已有用户的选择不变。
ALTER TABLE "users" ALTER COLUMN "persona" SET DEFAULT 'gentle';
