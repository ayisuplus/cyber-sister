import { randomUUID } from 'node:crypto'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { createMemory, validateMemoryInput } from './memoryService.js'
import { conflict, withMemoryTransaction } from './memoryGovernance.js'

const list = (value) => Array.isArray(value) ? value : []
const tags = (value) => { try { return typeof value === 'string' ? JSON.parse(value) : list(value) } catch { return [] } }
const evidenceList = (value) => { try { return list(typeof value === 'string' ? JSON.parse(value) : value) } catch { return [] } }
const canonicalKey = (value) => JSON.stringify([value.type, value.content, value.importance, [...tags(value.tags)].sort(), value.expiresAt ? new Date(value.expiresAt).toISOString() : null, value.origin])
const historyKey = (revisions) => JSON.stringify(list(revisions).map((revision) => [revision.revision, canonicalKey(revision),
  revision.action, new Date(revision.confirmedAt).toISOString(), revision.restoredFrom ?? null]))

export async function exportMemoryBundle(userId) {
  return prisma.$transaction((tx) => buildMemoryBundle(userId, tx), { isolationLevel: 'RepeatableRead' })
}

async function buildMemoryBundle(userId, database) {
  const [memories, edges] = await Promise.all([
    database.memory.findMany({ where: { userId }, include: { revisions: { orderBy: { revision: 'asc' } } }, orderBy: { id: 'asc' } }),
    database.memoryEdge.findMany({ where: { userId, status: { in: ['canonical', 'needs_review'] } } }),
  ])
  const ids = new Map(memories.map((memory) => [memory.id, memory.portableId]))
  const sources = (items) => list(items).map((source) => source.type === 'memory'
    ? { ...source, id: ids.get(source.id) ?? null, status: ids.has(source.id) ? source.status : 'missing' } : source)
  const snapshot = (memory) => ({ type: memory.type, content: memory.content, importance: memory.importance,
    tags: tags(memory.tags), expiresAt: memory.expiresAt, origin: memory.origin, sources: sources(memory.sources), revision: memory.revision })
  return {
    version: 2,
    memories: memories.map((memory) => ({ id: memory.portableId, importedAt: memory.importedAt, ...snapshot(memory),
      revisions: memory.revisions.map((revision) => ({ ...snapshot(revision), action: revision.action,
        confirmedAt: revision.confirmedAt, restoredFrom: revision.restoredFrom, imported: revision.imported })),
    })),
    edges: edges.filter((edge) => ids.has(edge.fromMemoryId) && ids.has(edge.toMemoryId)).map((edge) => ({
      id: edge.id, from: ids.get(edge.fromMemoryId), to: ids.get(edge.toMemoryId), relation: edge.relation,
      status: edge.status, fromRevision: edge.fromRevision, toRevision: edge.toRevision, decisions: list(edge.decisions),
      evidence: sources(evidenceList(edge.evidence)),
    })),
  }
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new HttpError('记忆版本格式不正确', 400)
  const fields = validateMemoryInput(snapshot)
  if (snapshot.sources !== undefined && (!Array.isArray(snapshot.sources) || snapshot.sources.length > 20)) throw new HttpError('每个版本最多包含 20 条来源', 400)
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) throw new HttpError('导入版本号不正确', 400)
  const expiresAt = snapshot.expiresAt ? new Date(snapshot.expiresAt) : null
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new HttpError('导入有效期不正确', 400)
  return { ...fields, revision: snapshot.revision, expiresAt,
    origin: ['manual', 'suggestion', 'promoted'].includes(snapshot.origin) ? snapshot.origin : 'manual', sources: list(snapshot.sources) }
}

function normalizeBundle(bundle) {
  if (bundle?.version !== 2 || !Array.isArray(bundle.memories) || !Array.isArray(bundle.edges)) throw new HttpError('记忆迁移包格式不正确', 400)
  if (bundle.memories.length > 10000 || bundle.edges.length > 20000) throw new HttpError('迁移包过大，请拆分后导入', 400)
  const ids = new Set()
  const memories = bundle.memories.map((item) => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id)) throw new HttpError('记忆引用重复或无效', 400)
    ids.add(item.id)
    const memory = normalizeSnapshot(item)
    const revisions = list(item.revisions).map((revision) => ({ ...normalizeSnapshot(revision),
      action: typeof revision.action === 'string' ? revision.action.slice(0, 40) : 'import',
      confirmedAt: new Date(revision.confirmedAt), restoredFrom: Number.isInteger(revision.restoredFrom) ? revision.restoredFrom : null,
    })).sort((a, b) => a.revision - b.revision)
    if (revisions.length !== memory.revision || revisions.some((revision, index) => revision.revision !== index + 1
      || !Number.isFinite(revision.confirmedAt.getTime())
      || (revision.restoredFrom !== null && (revision.restoredFrom < 1 || revision.restoredFrom >= revision.revision)))
      || canonicalKey(revisions.at(-1)) !== canonicalKey(memory)
      || JSON.stringify(revisions.at(-1)?.sources) !== JSON.stringify(memory.sources)) {
      throw new HttpError('历史版本不连续或与当前内容不一致', 400)
    }
    return { id: item.id, ...memory, revisions }
  })
  const edgeIds = new Set()
  for (const edge of bundle.edges) {
    if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to
      || !['similar', 'related', 'contradicts'].includes(edge.relation)
      || !['canonical', 'needs_review'].includes(edge.status)) throw new HttpError('关系引用不完整或不合法', 400)
    if (edge.evidence !== undefined && (!Array.isArray(edge.evidence) || edge.evidence.length > 20)) throw new HttpError('关系依据格式不正确', 400)
    if (list(edge.evidence).some((source) => source?.type === 'memory' && source.id && ![edge.from, edge.to].includes(source.id))) throw new HttpError('关系依据必须来自其两端记忆', 400)
    edgeIds.add(edge.id)
    for (const side of ['from', 'to']) {
      const memory = memories.find((item) => item.id === edge[side])
      if (!Number.isInteger(edge[`${side}Revision`]) || edge[`${side}Revision`] < 1 || edge[`${side}Revision`] > memory.revision) throw new HttpError('关系引用版本不正确', 400)
      if (edge.status === 'canonical' && edge[`${side}Revision`] !== memory.revision) throw new HttpError('已确认关系引用了旧版本', 400)
    }
  }
  return { memories, edges: bundle.edges }
}

export async function previewMemoryImport(userId, bundle, database = prisma) {
  const normalized = normalizeBundle(bundle)
  const existing = await database.memory.findMany({ where: { userId }, include: { revisions: { orderBy: { revision: 'asc' } } } })
  const byPortableId = new Map(existing.map((memory) => [memory.portableId, memory]))
  return {
    memories: normalized.memories.map((memory) => {
      const current = byPortableId.get(memory.id)
      return { ...memory, state: !current ? 'new' : current.revision === memory.revision && canonicalKey(current) === canonicalKey(memory)
        && historyKey(current.revisions) === historyKey(memory.revisions) ? 'duplicate' : 'conflict' }
    }),
    edges: normalized.edges,
  }
}

function remapSources(sources, mapping, imported) {
  return list(sources).slice(0, 20).map((source) => {
    if (source?.type === 'memory' && mapping.has(source.id)) {
      const original = imported.find((memory) => memory.id === source.id)
      const revision = original?.revisions.find((item) => item.revision === source.revision)
      if (typeof source.quote === 'string' && source.quote.trim() && revision?.content.includes(source.quote) && source.quote.length <= 2000) {
        return { type: 'memory', id: mapping.get(source.id), revision: source.revision, quote: source.quote, status: 'imported' }
      }
    }
    // 外部包中的本地 id 不具备访问当前账户对象的权力，缺失来源只保留声明的片段。
    return { type: source?.type === 'memory' ? 'memory' : 'message', status: 'missing',
      quote: typeof source === 'string' ? source.slice(0, 2000) : typeof source?.quote === 'string' ? source.quote.slice(0, 2000) : '' }
  })
}

export async function applyMemoryImport(userId, { bundle, selectedIds, selectedEdgeIds = [] }, database = null) {
  if (!Array.isArray(selectedIds) || !Array.isArray(selectedEdgeIds)) throw new HttpError('需要选择要导入的内容', 400)
  const apply = async (tx) => {
    const preview = await previewMemoryImport(userId, bundle, tx)
    const selected = new Set(selectedIds)
    if (selected.size !== selectedIds.length || selectedIds.some((id) => !preview.memories.some((memory) => memory.id === id))) throw new HttpError('选择的记忆不在迁移包中', 400)
    const memories = preview.memories.filter((memory) => selected.has(memory.id))
    if (memories.some((memory) => memory.state === 'conflict')) throw conflict('目标记忆已有不同内容，未覆盖任何记录')
    const mapping = new Map()
    let memoriesApplied = 0
    for (const memory of memories) {
      if (memory.state === 'duplicate') {
        // eslint-disable-next-line no-await-in-loop
        const existing = await tx.memory.findUnique({ where: { userId_portableId: { userId, portableId: memory.id } } })
        mapping.set(memory.id, existing.id)
      } else mapping.set(memory.id, randomUUID())
    }
    for (const memory of memories.filter((item) => item.state === 'new')) {
      const memoryId = mapping.get(memory.id)
      const sources = remapSources(memory.sources, mapping, memories)
      // 所有正式写入先经过共同的校验与版本记录入口，再恢复包内历史。
      // eslint-disable-next-line no-await-in-loop
      await createMemory(userId, { ...memory, sourceRef: null, origin: 'manual', sources }, {
        tx, memoryId, portableId: memory.id, action: 'import', trustedSources: true, projectEmbedding: false,
      })
      // eslint-disable-next-line no-await-in-loop
      await tx.memory.update({ where: { id: memoryId }, data: { revision: memory.revision, origin: memory.origin, expiresAt: memory.expiresAt, importedAt: new Date() } })
      // eslint-disable-next-line no-await-in-loop
      await tx.memoryRevision.deleteMany({ where: { memoryId } })
      // eslint-disable-next-line no-await-in-loop
      await tx.memoryRevision.createMany({ data: memory.revisions.map((revision) => ({
        ...revision, memoryId, imported: true, tags: JSON.stringify(revision.tags), sources: remapSources(revision.sources, mapping, memories),
      })) })
      memoriesApplied++
    }
    const edgeSelection = new Set(selectedEdgeIds)
    if (edgeSelection.size !== selectedEdgeIds.length || selectedEdgeIds.some((id) => !preview.edges.some((edge) => edge.id === id))) throw new HttpError('选择的关系不在迁移包中', 400)
    let edgesApplied = 0
    for (const edge of preview.edges.filter((item) => edgeSelection.has(item.id))) {
      if (!mapping.has(edge.from) || !mapping.has(edge.to)) throw new HttpError('导入关系前需要同时选择两端记忆', 400)
      const fromMemoryId = mapping.get(edge.from)
      const toMemoryId = mapping.get(edge.to)
      // eslint-disable-next-line no-await-in-loop
      const existing = await tx.memoryEdge.findFirst({ where: { userId, relation: edge.relation,
        OR: [{ fromMemoryId, toMemoryId }, { fromMemoryId: toMemoryId, toMemoryId: fromMemoryId }] } })
      if (existing) continue
      // eslint-disable-next-line no-await-in-loop
      await tx.memoryEdge.create({ data: { userId, fromMemoryId, toMemoryId, relation: edge.relation,
        status: edge.status, fromRevision: edge.fromRevision, toRevision: edge.toRevision,
        evidence: JSON.stringify(remapSources(edge.evidence, mapping, memories)),
        decisions: [...list(edge.decisions).filter((decision) => decision && typeof decision === 'object').map((decision) => ({ action: String(decision.action || 'confirm').slice(0, 40),
          at: String(decision.at || '').slice(0, 40), fromRevision: Number.isInteger(decision.fromRevision) ? decision.fromRevision : null,
          toRevision: Number.isInteger(decision.toRevision) ? decision.toRevision : null, imported: true })),
        { action: 'import', at: new Date().toISOString(), fromRevision: edge.fromRevision, toRevision: edge.toRevision }],
      } })
      edgesApplied++
    }
    return { memoriesApplied, memoriesSkipped: memories.length - memoriesApplied, edgesApplied }
  }
  return database ? apply(database) : withMemoryTransaction(userId, apply)
}
