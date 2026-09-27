-- 每日天气：用户在设置里自己填、从候选里选中的城市（名字、省份、国家、坐标、时区）。
-- 不定位；空 = 没填城市，界面不显示天气，她也不知道天气。
ALTER TABLE "users" ADD COLUMN "weather_place" JSONB;
