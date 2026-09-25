-- 路线图 C23：她的组织层合成一张表 inferences（关系 / 理解 / 惦记的事），一套生命周期。
-- 旧表 memory_edges、derived_insights、follow_ups 原样保留只读、不再有写入方，下一周期另批删除。
-- 去重键与 apps/api/src/services/memory/inferenceService.js 的 dedupeKeyOf 逐字一致：
--   NFKC、去掉全部空白、小写（utils/normalizeKey.js）；关系两端按 C 排序（与 JS 字符串排序一致）。

-- CreateTable
CREATE TABLE "inferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "basis" JSONB NOT NULL DEFAULT '[]',
    "basis_memory_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "outcome" TEXT,
    "lettered_at" TIMESTAMP(3),
    "proposed_in" JSONB,
    "dedupe_key" TEXT NOT NULL,
    "produced_by" TEXT NOT NULL,
    "due_on" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inferences_user_id_status_kind_idx" ON "inferences"("user_id", "status", "kind");

-- CreateIndex
CREATE INDEX "inferences_user_id_kind_due_on_idx" ON "inferences"("user_id", "kind", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "inferences_user_id_dedupe_key_key" ON "inferences"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "inferences" ADD CONSTRAINT "inferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 数据迁移：同一个去重键只留优先级最高的一条（ON CONFLICT DO NOTHING + 按优先级插入）。

-- 关系：推测与已确认 → 有效；待重审 → 作废；已忽略 → 结束（不用）
INSERT INTO "inferences" ("id", "user_id", "kind", "content", "payload", "basis", "basis_memory_ids", "status", "outcome",
  "dedupe_key", "produced_by", "created_at", "updated_at")
SELECT gen_random_uuid()::text, e."user_id", 'relation',
  '「' || left(f."content", 60) || '」与「' || left(t."content", 60) || '」'
    || CASE e."relation" WHEN 'similar' THEN '说的可能是一回事' WHEN 'contradicts' THEN '好像互相矛盾' ELSE '有关' END,
  jsonb_build_object('fromMemoryId', e."from_memory_id", 'toMemoryId', e."to_memory_id", 'relation', e."relation",
    'confidence', e."confidence", 'confirmed', e."status" = 'canonical'),
  COALESCE(NULLIF(e."evidence", '')::jsonb, '[]'::jsonb),
  ARRAY[e."from_memory_id", e."to_memory_id"],
  CASE e."status" WHEN 'needs_review' THEN 'stale' WHEN 'dismissed' THEN 'closed' ELSE 'active' END,
  CASE e."status" WHEN 'dismissed' THEN 'declined' ELSE NULL END,
  'relation:' || LEAST(e."from_memory_id" COLLATE "C", e."to_memory_id" COLLATE "C") || ':'
    || GREATEST(e."from_memory_id" COLLATE "C", e."to_memory_id" COLLATE "C") || ':' || e."relation",
  'migration', e."created_at", e."updated_at"
FROM "memory_edges" e
JOIN "memories" f ON f."id" = e."from_memory_id"
JOIN "memories" t ON t."id" = e."to_memory_id"
ORDER BY CASE e."status" WHEN 'canonical' THEN 0 WHEN 'derived' THEN 1 WHEN 'needs_review' THEN 2 ELSE 3 END, e."created_at" DESC
ON CONFLICT ("user_id", "dedupe_key") DO NOTHING;

-- 理解：有效 → 有效（30 天有效期）；待重审 → 作废；进过信的 → 有效并记下进过信；你忽略过的 → 否决；晋升/厘清 → 结束（采纳）
INSERT INTO "inferences" ("id", "user_id", "kind", "content", "payload", "basis", "basis_memory_ids", "status", "outcome",
  "lettered_at", "dedupe_key", "produced_by", "expires_at", "created_at", "updated_at")
SELECT gen_random_uuid()::text, d."user_id", 'insight', d."content",
  jsonb_build_object('category', d."kind", 'confidence', d."confidence"),
  d."sources", d."source_memory_ids",
  CASE
    WHEN d."status" = 'active' THEN 'active'
    WHEN d."status" = 'needs_review' THEN 'stale'
    WHEN d."status" = 'dismissed' AND d."resolution" LIKE 'lettered:%' THEN 'active'
    WHEN d."status" = 'dismissed' THEN 'vetoed'
    ELSE 'closed'
  END,
  CASE WHEN d."status" IN ('promoted', 'resolved') THEN 'accepted' ELSE NULL END,
  CASE WHEN d."resolution" LIKE 'lettered:%' THEN d."updated_at" ELSE NULL END,
  'insight:' || lower(regexp_replace(normalize(d."content", NFKC), '[[:space:]]+', '', 'g')),
  'migration', d."created_at" + interval '30 days', d."created_at", d."updated_at"
FROM "derived_insights" d
ORDER BY CASE d."status" WHEN 'active' THEN 0 WHEN 'promoted' THEN 1 WHEN 'resolved' THEN 1 ELSE 2 END, d."created_at" DESC
ON CONFLICT ("user_id", "dedupe_key") DO NOTHING;

-- 惦记的事：有效 → 有效；问过 → 结束（asked）；删过 → 否决。到日子起三天内问，之后过期
INSERT INTO "inferences" ("id", "user_id", "kind", "content", "payload", "status", "outcome",
  "dedupe_key", "produced_by", "due_on", "expires_at", "created_at", "updated_at")
SELECT gen_random_uuid()::text, u."user_id", 'followup', u."ask",
  jsonb_build_object('about', u."about", 'ask', u."ask"),
  CASE u."status" WHEN 'asked' THEN 'closed' WHEN 'dismissed' THEN 'vetoed' ELSE 'active' END,
  CASE u."status" WHEN 'asked' THEN 'asked' ELSE NULL END,
  'followup:' || to_char(u."ask_on", 'YYYY-MM-DD') || ':' || lower(regexp_replace(normalize(u."about", NFKC), '[[:space:]]+', '', 'g')),
  'migration', u."ask_on", u."ask_on" + interval '3 days', u."created_at", u."updated_at"
FROM "follow_ups" u
ORDER BY CASE u."status" WHEN 'active' THEN 0 WHEN 'asked' THEN 1 ELSE 2 END, u."created_at" DESC
ON CONFLICT ("user_id", "dedupe_key") DO NOTHING;
