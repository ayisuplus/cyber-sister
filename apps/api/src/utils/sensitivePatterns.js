/**
 * 候选侧最保守的敏感内容正则排除：宁可放弃候选，也不冒记住敏感信息的风险。
 * 供记忆候选（memorySuggestionService）与她的工作台（derivedService）共用同一套口径。
 */
export const REDACTION_PLACEHOLDER_PATTERN = /\[(?:手机号|邮箱|证件号)\]/
export const SENSITIVE_LOCATION_PATTERNS = [
  /(?:省|市|区|县|镇|乡).{0,8}(?:路|街|巷|弄|号|栋|单元|室)/,
  /(?:地址|住址|定位|坐标)\s*[:：是为]/,
  /\b-?\d{1,3}\.\d{4,}[,，\s]+-?\d{1,3}\.\d{4,}\b/, // GPS 坐标对
]
export const SENSITIVE_MEDICAL_PATTERNS = [
  /(?:诊断|确诊|病历|处方|服药|剂量|毫克|复诊|挂号)/,
  /(?:抑郁症|焦虑症|精神分裂|双相情感障碍|强迫症)/,
  /\b\d+(?:\.\d+)?\s*mg\b/i,
]
