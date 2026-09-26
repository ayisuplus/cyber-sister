/**
 * 三类向量的阈值集中在这里，写明各自怎么定的（路线图 C23）。改阈值要有评测依据，并记进对应的评测文档。
 *
 * - 记忆 0.52：2026-09-25 用记忆检索评测（eval:memories，docs/04-开发/记忆检索评测.md）在 Qwen3-Embedding-0.6B 上重标。
 *   是「不该带记忆、字面撞车、字面对得上的句子，向量一条无关记忆也不多带」的最低一档（与她的书 0.55 同一条标准）；
 *   原先的 0.35 是 2026-09-09 为别的模型定的，在这个模型上连「嗯嗯」都会带进 5 条无关记忆。
 *   向量分只是加分项：关键词与标签照样算。
 *   corroborate（2026-09-26 裁定开启，同一份文档「对照实验一」）：关键词只撞上一个两字片段、又没有标签印证时，
 *   要这条记忆的向量也够上阈值才算；多带的无关记忆 68 → 26 条，召回不变。算不了向量时照旧按关键词。
 * - 内置书 0.50：写在书架索引 skills/book-index.json 里，随索引一起标定（docs/04-开发/书架选章评测.md）；
 *   只有关键词一章都没认出时才用，全书架最多补一章。
 * - 她的书 0.55：点了书名放低 0.1（同上文档「她的书」一节）；一轮最多一段。
 */
export const VECTOR_POLICIES = Object.freeze({
  memory: Object.freeze({ minScore: 0.52, corroborate: true, calibration: 'docs/04-开发/记忆检索评测.md，Qwen3-Embedding-0.6B，0.52' }),
  card: Object.freeze({ minScore: 'book-index.json', calibration: 'docs/04-开发/书架选章评测.md，0.50' }),
  passage: Object.freeze({ minScore: 0.55, namedEasing: 0.1, calibration: 'docs/04-开发/书架选章评测.md「她的书」，0.55' }),
})

/** 送去算向量的文字上限：本机向量服务一条最多 8000 字，聊天一条最多 10000 字。 */
export const MAX_EMBED_INPUT_CHARS = 8000
