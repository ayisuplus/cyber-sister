/** 仅处理确定性高的直接标识符；调用方使用发送副本，不改用户原始存储内容。 */
export function redactSensitiveText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱]')
    .replace(/\b\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, '[证件号]')
    .replace(/\b\d{15}\b/g, '[证件号]')
    .replace(/(?:\+?86[-\s]?)?1[3-9](?:[-\s]?\d){9}/g, '[手机号]')
}
