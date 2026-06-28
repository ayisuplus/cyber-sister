// RunningHub Provider — 调用 RunningHub 妆容迁移 AI 应用
// webappId: 2069665150138937346
// 工作流: StableMakeup (Load Image × 2 → StableMakeup_Sampler → Save Image)

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  sleep,
  type ImageGenerationProvider,
  type ProviderInput,
  type ProviderOutput,
} from './types.js';

// ---------- 配置 ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

// RunningHub API 配置
const RUNNINGHUB_API_BASE = 'https://www.runninghub.cn';
const WEBAPP_ID = '2069665150138937346';

// 从多个候选位置读取 API Key (按优先级):
// 1) 环境变量 RUNNINGHUB_API_KEY
// 2) 项目根目录的 .env / .env.local
// 3) ~/.cc-switch/skills/runninghub/.env (向后兼容旧 skill 安装)
const ENV_CANDIDATES: ReadonlyArray<string> = [
  resolve(PROJECT_ROOT, '.env'),
  resolve(PROJECT_ROOT, '.env.local'),
  resolve(
    process.env.HOME || process.env.USERPROFILE || '',
    '.cc-switch',
    'skills',
    'runninghub',
    '.env',
  ),
];

function readKeyFromEnvFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8');
  const match = content.match(/^\s*RUNNINGHUB_API_KEY\s*=\s*(.+?)\s*$/m);
  return match?.[1] ?? null;
}

function getApiKey(): string {
  if (process.env.RUNNINGHUB_API_KEY) return process.env.RUNNINGHUB_API_KEY;
  for (const path of ENV_CANDIDATES) {
    const key = readKeyFromEnvFile(path);
    if (key) return key;
  }
  throw new Error(
    'RUNNINGHUB_API_KEY 未配置。请设置环境变量，或在项目根 .env / .env.local 中添加 ' +
      '`RUNNINGHUB_API_KEY=...`，或在 ~/.cc-switch/skills/runninghub/.env 中配置。',
  );
}

// ---------- 妆容参考图映射 ----------

// 妆容风格 → 参考图文件名
const MAKEUP_REFERENCE_MAP: Record<string, string> = {
  look_cool_water: '清冷白开水妆.png',
  look_peach_date: '清透蜜桃妆.png',
  look_power_queen: '气场御姐妆.png',
  look_fox_red: '狐系红妆.jpg',
  look_korean: '精致韩系妆.png',
  look_pure_desire: '自然纯欲妆.jpg',
};

function getMakeupReferencePath(style: string): string {
  const filename = MAKEUP_REFERENCE_MAP[style];
  if (!filename) {
    // 默认用清冷白开水妆
    return join(PROJECT_ROOT, '妆容参考图片', '清冷白开水妆.png');
  }
  return join(PROJECT_ROOT, '妆容参考图片', filename);
}

// ---------- RunningHub API 调用 ----------

interface RunningHubTaskResponse {
  taskId: string;
  status: string;
}

interface RunningHubTaskStatus {
  taskId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  output?: {
    images?: Array<{ url: string }>;
  };
  error?: string;
}

/**
 * 创建 RunningHub AI 应用任务
 */
async function createTask(
  apiKey: string,
  userImagePath: string,
  makeupImagePath: string,
): Promise<string> {
  const url = `${RUNNINGHUB_API_BASE}/openapi/v2/task/submit`;

  // 构建请求体
  // RunningHub AI 应用需要指定 webappId 和节点参数
  const body = {
    webappId: WEBAPP_ID,
    nodeInfoList: [
      {
        nodeId: '3', // Load Image (用户人脸)
        fieldName: 'image',
        fieldValue: userImagePath,
      },
      {
        nodeId: '4', // Load Image (妆容参考图)
        fieldName: 'image',
        fieldValue: makeupImagePath,
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RunningHub API 错误: ${response.status} ${text}`);
  }

  const data = (await response.json()) as RunningHubTaskResponse;
  return data.taskId;
}

/**
 * 查询任务状态
 */
async function getTaskStatus(
  apiKey: string,
  taskId: string,
): Promise<RunningHubTaskStatus> {
  const url = `${RUNNINGHUB_API_BASE}/openapi/v2/task/status/${taskId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RunningHub 状态查询错误: ${response.status} ${text}`);
  }

  return (await response.json()) as RunningHubTaskStatus;
}

/**
 * 下载生成的图片
 */
async function downloadImage(imageUrl: string, outputPath: string): Promise<void> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
}

// ---------- Provider 实现 ----------

export class RunningHubProvider implements ImageGenerationProvider {
  readonly name = 'runninghub';

  async generate(input: ProviderInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const t0 = Date.now();
    const apiKey = getApiKey();

    // 获取妆容参考图路径
    const makeupRefPath = getMakeupReferencePath(input.style);

    // 验证参考图存在
    if (!existsSync(makeupRefPath)) {
      throw new Error(`妆容参考图不存在: ${makeupRefPath}`);
    }

    // 验证用户图片存在
    if (!existsSync(input.imagePath)) {
      throw new Error(`用户图片不存在: ${input.imagePath}`);
    }

    // 创建任务
    const taskId = await createTask(apiKey, input.imagePath, makeupRefPath);

    // 轮询任务状态
    const maxWaitMs = 3 * 60 * 1000; // 3 分钟超时
    const pollIntervalMs = 3000; // 每 3 秒查一次
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const status = await getTaskStatus(apiKey, taskId);

      if (status.status === 'COMPLETED') {
        // 获取生成的图片 URL
        const imageUrl = status.output?.images?.[0]?.url;
        if (!imageUrl) {
          throw new Error('任务完成但未返回图片 URL');
        }

        // 下载图片到本地
        const outputFilename = `runninghub_${taskId}.png`;
        const outputPath = join(PROJECT_ROOT, 'public', 'results', outputFilename);
        await downloadImage(imageUrl, outputPath);

        return {
          resultUrl: `/results/${outputFilename}`,
          tookMs: Date.now() - t0,
          provider: this.name,
        };
      }

      if (status.status === 'FAILED') {
        throw new Error(`RunningHub 任务失败: ${status.error || '未知错误'}`);
      }

      // 等待后再轮询
      await sleep(pollIntervalMs, signal);
    }

    throw new Error(`RunningHub 任务超时 (${maxWaitMs / 1000}秒)`);
  }
}
