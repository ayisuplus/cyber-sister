-- 路线图 C27：花草图鉴收进来那一刻，本机名录与毒性库的核对结果。只加一列，旧数据为 NULL（当时没核）。
ALTER TABLE "plant_entries" ADD COLUMN "reference" JSONB;
