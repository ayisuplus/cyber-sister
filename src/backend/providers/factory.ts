// Provider factory — picks the active ImageGenerationProvider based on
// the IMAGE_GEN_PROVIDER env var. Add new providers here.

import { config } from '../config.js';
import type { ImageGenerationProvider } from './types.js';
import { NoopProvider } from './noop.js';
import { MockProvider } from './mock.js';

let cached: ImageGenerationProvider | null = null;

export function getImageGenerationProvider(): ImageGenerationProvider {
  if (cached) return cached;
  cached = create(config.imageGenProvider);
  return cached;
}

/**
 * Force re-instantiation. Useful for tests that want to swap providers
 * after mutating process.env.
 */
export function resetImageGenerationProvider(): void {
  cached = null;
}

function create(name: string): ImageGenerationProvider {
  switch (name) {
    case 'mock':
      return new MockProvider();
    case 'noop':
      return new NoopProvider();
    // case 'replicate':
    //   return new ReplicateProvider({ apiKey: process.env.REPLICATE_API_KEY });
    default:
      // Unknown provider name → fail loud, don't silently noop.
      throw new Error(`Unknown IMAGE_GEN_PROVIDER: "${name}". Supported: mock | noop`);
  }
}
