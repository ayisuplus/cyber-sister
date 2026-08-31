import { beforeEach, describe, expect, it, vi } from 'vitest';

interface InternalRouter {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (req: unknown, res: unknown) => unknown }>;
    };
  }>;
}

const validRequest = {
  features: {
    faceShape: 'oval',
    skinTone: 'cool_fair',
    eyeType: 'almond',
  },
  lookId: 'look_cool_water',
};

async function postExplain(body: unknown, authorization?: string) {
  const { explainRouter } = await import('../src/backend/routes/explain');
  const internal = explainRouter as unknown as InternalRouter;
  const route = internal.stack.find(
    (layer) => layer.route?.path === '/explain' && layer.route.methods.post,
  )?.route;
  if (!route?.stack[0]) throw new Error('POST /explain route not found');

  let status = 200;
  let responseBody: unknown;
  const req = {
    id: 'request-test-1',
    body,
    get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
  };
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      responseBody = payload;
      return this;
    },
  };

  await route.stack[0].handle(req, res);
  return { status, body: responseBody as Record<string, unknown> };
}

function explainResponse(
  explanation: string,
  source: 'local_model' | 'qwen' | 'local_template',
): Response {
  return new Response(JSON.stringify({ explanation, source }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /explain contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('给主 API 留出完整模型预算后再降级', async () => {
    const { MAIN_API_TIMEOUT_MS } = await import('../src/backend/routes/explain');

    expect(MAIN_API_TIMEOUT_MS).toBe(65_000);
  });

  it('只接受 features 三个规范化标签和 lookId', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const extraOuter = await postExplain({ ...validRequest, image: 'data:image/jpeg;base64,abc' });
    const extraFeature = await postExplain({
      ...validRequest,
      features: { ...validRequest.features, confidence: 0.99 },
    });
    const unknownLook = await postExplain({ ...validRequest, lookId: 'not-built-in' });

    expect(extraOuter.status).toBe(400);
    expect(extraFeature.status).toBe(400);
    expect(unknownLook.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未登录时直接返回透明标识的本地模板', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await postExplain(validRequest);

    expect(result.status).toBe(200);
    expect(result.body.source).toBe('local_template');
    expect(String(result.body.explanation).length).toBeGreaterThan(0);
    expect(Array.from(String(result.body.explanation)).length).toBeLessThanOrEqual(50);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('登录后只把规范化标签、lookId、Authorization 与 request ID 转发给主 API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(explainResponse('本机解释', 'local_model'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postExplain(validRequest, 'Bearer access-token');

    expect(result.body).toEqual({ explanation: '本机解释', source: 'local_model' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/llm/explain');
    expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
        'X-Request-Id': 'request-test-1',
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual(validRequest);
    expect(String(init.body)).not.toMatch(/data:image|base64|confidence|用户.?ID|手机号/iu);
  });

  it('保留云端来源，并将主 API 输出限制为 50 个 Unicode 字符', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(explainResponse(`${'妆'.repeat(48)}💄💄额外内容`, 'qwen'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postExplain(validRequest, 'Bearer access-token');

    expect(result.body.source).toBe('qwen');
    expect(Array.from(String(result.body.explanation))).toHaveLength(50);
  });

  it('主 API 拒绝、失败或返回不可信合同都降级为本地模板', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockRejectedValueOnce(new Error('main API unavailable'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ explanation: '伪解释', source: 'unknown_provider' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const unauthorized = await postExplain(validRequest, 'Bearer expired');
    const unavailable = await postExplain(validRequest, 'Bearer access-token');
    const invalid = await postExplain(validRequest, 'Bearer access-token');

    for (const result of [unauthorized, unavailable, invalid]) {
      expect(result.status).toBe(200);
      expect(result.body.source).toBe('local_template');
      expect(String(result.body.explanation).length).toBeGreaterThan(0);
    }
  });
});
