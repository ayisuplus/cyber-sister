// Mock provider — generates a deterministic, style-tinted SVG placeholder.
// Used for development and CI. Not for production.
//
// Writes the SVG to public/results/<jobId>.svg and returns the URL.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  sleep,
  type ImageGenerationProvider,
  type ProviderInput,
  type ProviderOutput,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

const STYLE_GRADIENTS: Record<string, [string, string, string]> = {
  // id → [stops] for the placeholder gradient
  default: ['#FBF4F0', '#E89F8C', '#8B2942'],
};

const SIMULATED_LATENCY_MS = 3_000;

function renderPlaceholderSVG(styleId: string, styleName: string, prompt: string): string {
  const stops = STYLE_GRADIENTS[styleId] ?? STYLE_GRADIENTS.default!;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${stops[0]}"/>
      <stop offset="55%" stop-color="${stops[1]}"/>
      <stop offset="100%" stop-color="${stops[2]}"/>
    </linearGradient>
    <filter id="b"><feGaussianBlur stdDeviation="50"/></filter>
  </defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  <circle cx="220" cy="500" r="200" fill="white" opacity="0.18" filter="url(#b)"/>
  <circle cx="600" cy="350" r="240" fill="white" opacity="0.14" filter="url(#b)"/>
  <text x="400" y="460" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',sans-serif"
        font-size="84" font-weight="700" fill="white" style="text-shadow:0 4px 24px rgba(0,0,0,0.2)">${styleName}</text>
  <text x="400" y="540" text-anchor="middle" font-family="'Noto Serif SC','PingFang SC',sans-serif"
        font-size="22" fill="white" opacity="0.85">妆容预览 · Mock Provider</text>
  <text x="400" y="900" text-anchor="middle" font-family="monospace"
        font-size="14" fill="white" opacity="0.55">${prompt.slice(0, 80)}</text>
</svg>`;
}

export class MockProvider implements ImageGenerationProvider {
  readonly name = 'mock';

  async generate(input: ProviderInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const t0 = Date.now();
    // Simulate model latency. Sleep honours cancellation.
    await sleep(SIMULATED_LATENCY_MS, signal);

    const jobId = `mock-${Date.now().toString(36)}`;
    const filename = `${jobId}.svg`;
    const outDir = join(PROJECT_ROOT, 'public', 'results');
    const outPath = join(outDir, filename);

    const svg = renderPlaceholderSVG(input.style, input.style, input.prompt);
    writeFileSync(outPath, svg, 'utf8');

    return {
      resultUrl: `/results/${filename}`,
      tookMs: Date.now() - t0,
      provider: this.name,
    };
  }
}
