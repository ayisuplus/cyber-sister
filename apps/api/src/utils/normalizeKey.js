/**
 * 去重键的唯一口径：NFKC、去掉全部空白、忽略大小写。
 * 记忆、记忆建议、导入、回想的草稿与惦记的事都用它判断「是不是同一句话」。
 * 中文里空白多是手滑或语音转写带出来的：「周五 面试」和「周五面试」算同一件事。
 */
export const normalizeKey = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
