// 共享 API 类型 — 前端 + 后端共用
// 风格元数据见 data.ts (STYLE_META)

export interface UploadResponse {
  imageId: string;
  url: string;
  size: number;
}

export interface GenerateRequest {
  imageId: string;
  style: string;
}

export interface GenerateResponse {
  imageId: string;
  style: string;
  resultUrl: string;
  prompt: string;
  tookMs: number;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
