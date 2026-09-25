/**
 * 三类向量的阈值集中在这里，写明各自怎么定的（路线图 C23）。改阈值要有评测依据，并记进对应的评测文档。
 *
 * - 记忆 0.35：2026-09-09 随语义投影定下，当时的向量模型不是现在的 Qwen3-Embedding-0.6B，换模型后未重标；
 *   记忆检索离线评测（eval:memories）重标之前先沿用。向量分只是加分项：关键词与标签照样算。
 * - 内置书 0.50：写在书架索引 skills/book-index.json 里，随索引一起标定（docs/04-开发/书架选章评测.md）；
 *   只有关键词一章都没认出时才用，全书架最多补一章。
 * - 她的书 0.55：点了书名放低 0.1（同上文档「她的书」一节）；一轮最多一段。
 */
export const VECTOR_POLICIES = Object.freeze({
  memory: Object.freeze({ minScore: 0.35, calibration: '2026-09-09，换 Qwen3-Embedding-0.6B 后未重标' }),
  card: Object.freeze({ minScore: 'book-index.json', calibration: 'docs/04-开发/书架选章评测.md，0.50' }),
  passage: Object.freeze({ minScore: 0.55, namedEasing: 0.1, calibration: 'docs/04-开发/书架选章评测.md「她的书」，0.55' }),
})

/** 送去算向量的文字上限：本机向量服务一条最多 8000 字，聊天一条最多 10000 字。 */
export const MAX_EMBED_INPUT_CHARS = 8000
