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
  // 经期与医疗同口径：PeriodRecord 有同意门，痕迹/候选文本里的经期内容同样不外送、不进素材
  /(?:月经|痛经|经期|经前|大姨妈|卫生巾|卫生棉条|月经杯|停经|闭经)/,
  /\b\d+(?:\.\d+)?\s*mg\b/i,
]

/** 敏感排除的唯一口径：命中联系方式/证件号占位符、精确位置或医疗内容即丢弃（宁可放弃，也不外送或记住）。 */
export function isSensitiveContent(content) {
  return REDACTION_PLACEHOLDER_PATTERN.test(content)
    || SENSITIVE_LOCATION_PATTERNS.some((pattern) => pattern.test(content))
    || SENSITIVE_MEDICAL_PATTERNS.some((pattern) => pattern.test(content))
}
