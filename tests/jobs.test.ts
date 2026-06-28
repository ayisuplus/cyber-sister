// JobStore unit tests — TTL, terminal status, cancel idempotency.

import { describe, it, expect, beforeEach } from 'vitest';
import { JobStore } from '../src/backend/jobs/store';

describe('JobStore', () => {
  let store: JobStore;
  beforeEach(() => {
    store = new JobStore(60_000, 0); // disable sweep for tests
  });

  function makeJob(style = 'look_cool_water') {
    return store.create({
      imageId: 'img-1',
      style,
      sessionId: 'sess-1',
      provider: 'mock',
      prompt: 'test',
    });
  }

  it('create 返回 queued 状态 + 递增 updatedAt', () => {
    const job = makeJob();
    expect(job.status).toBe('queued');
    expect(job.createdAt).toBeGreaterThan(0);
    expect(job.updatedAt).toBe(job.createdAt);
  });

  it('get 找不到时返回 undefined', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('setStatus 转 running 正确推进 updatedAt', async () => {
    const job = makeJob();
    await new Promise((r) => setTimeout(r, 2));
    const next = store.setStatus(job.id, 'running');
    expect(next?.status).toBe('running');
    expect(next!.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
  });

  it('setStatus(succeeded, { resultUrl }) 写入结果', () => {
    const job = makeJob();
    store.setStatus(job.id, 'running');
    const done = store.setStatus(job.id, 'succeeded', { resultUrl: '/results/x.svg' });
    expect(done?.status).toBe('succeeded');
    expect(done?.resultUrl).toBe('/results/x.svg');
  });

  it('cancel 已终止任务 → 保持原状态 (idempotent)', () => {
    const job = makeJob();
    store.setStatus(job.id, 'succeeded', { resultUrl: '/results/x.svg' });
    const after = store.cancel(job.id);
    expect(after?.status).toBe('succeeded');
  });

  it('cancel 运行中任务 → cancelled', () => {
    const job = makeJob();
    store.setStatus(job.id, 'running');
    const after = store.cancel(job.id);
    expect(after?.status).toBe('cancelled');
  });

  it('cancel 找不到任务 → undefined', () => {
    expect(store.cancel('nope')).toBeUndefined();
  });

  it('list 按 sessionId 过滤 + 按 createdAt desc 排序', async () => {
    const a = store.create({ imageId: 'a', style: 's', sessionId: 'X', provider: 'p', prompt: '' });
    // Force a measurable gap so createdAt differs.
    await new Promise((r) => setTimeout(r, 3));
    const b = store.create({ imageId: 'b', style: 's', sessionId: 'X', provider: 'p', prompt: '' });
    store.create({ imageId: 'c', style: 's', sessionId: 'Y', provider: 'p', prompt: '' });
    const xList = store.list({ sessionId: 'X' });
    expect(xList.map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it('cleanup 删除 ttlMs 之前的已完成任务', () => {
    const job = makeJob();
    store.setStatus(job.id, 'succeeded', { resultUrl: '/results/x.svg' });
    // ttl = 60_000, fake clock = 90_000ms later
    const removed = store.cleanup(job.createdAt + 90_000);
    expect(removed).toBe(1);
    expect(store.get(job.id)).toBeUndefined();
  });

  it('cleanup 保留未完成任务', () => {
    const job = makeJob();
    store.setStatus(job.id, 'running');
    const removed = store.cleanup(job.createdAt + 90_000);
    expect(removed).toBe(0);
    expect(store.get(job.id)).toBeDefined();
  });

  it('destroy 清空且停止 sweeper', () => {
    const a = makeJob();
    void a;
    store.destroy();
    expect(store.size()).toBe(0);
  });
});
