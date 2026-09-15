export const PROJECTION_RULE_VERSION = 1

export function embeddingConfig(env = process.env) {
  const { MEMORY_EMBEDDING_BASE_URL: baseUrl, MEMORY_EMBEDDING_MODEL: model,
    MEMORY_EMBEDDING_API_KEY: apiKey, MEMORY_EMBEDDING_DIMENSIONS: rawDimensions } = env
  const dimensions = Number(rawDimensions)
  if (!baseUrl || !model || !apiKey || !Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65536) return null
  try {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') return null
    const provider = url.href.replace(/\/$/, '')
    return { provider, model, dimensions, ruleVersion: PROJECTION_RULE_VERSION, apiKey }
  } catch { return null }
}

export function projectionMatches(projection, revision, config = embeddingConfig()) {
  return Boolean(config && projection && projection.memoryRevision === revision
    && projection.provider === config.provider && projection.model === config.model
    && projection.dimensions === config.dimensions && projection.ruleVersion === config.ruleVersion
    && Array.isArray(projection.vector) && projection.vector.length === config.dimensions
    && projection.vector.every(Number.isFinite) && projection.vector.some((value) => value !== 0))
}

export function embeddingStatus() {
  const config = embeddingConfig()
  return { configured: Boolean(config), model: config?.model ?? null,
    mode: config ? 'configured' : 'keyword', available: null }
}
