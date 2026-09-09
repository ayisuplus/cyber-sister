// 标签输入统一口径：中英文逗号分隔，去首尾空白与空项
export const parseTags = (value) => value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
