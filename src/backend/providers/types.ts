// Image generation provider interface.
//
// A provider receives a local image path + style + face features and
// returns the URL where the generated image is hosted on our server.
//
// Implementations:
//   - NoopProvider  : throws unless IMAGE_GEN_PROVIDER is set explicitly
//   - MockProvider  : deterministic SVG, ~3s, dev/test only
//   - (future) ReplicateProvider / StabilityProvider / DoubaoProvider
//
// The factory in ./factory.ts picks one based on IMAGE_GEN_PROVIDER env.

import type { FaceFeatures } from '../../shared/types.js';

export interface ProviderInput {
  /** Absolute path to the input image on the server's local disk. */
  imagePath: string;
  /** MIME type, e.g. 'image/jpeg'. */
  imageMime: string;
  /** Makeup look id from src/shared/data/looks.json. */
  style: string;
  /** Composed English prompt (LoRA trigger + scene context). */
  prompt: string;
  /** Optional structured face features for prompt composition. */
  features?: FaceFeatures;
}

export interface ProviderOutput {
  /** Public URL where the generated result is served (under /results/...). */
  resultUrl: string;
  /** Wall-clock duration of the generation call. */
  tookMs: number;
  /** Provider name, echoed back for logging/debug. */
  provider: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(input: ProviderInput, signal?: AbortSignal): Promise<ProviderOutput>;
}

/**
 * Helper: sleep with AbortSignal. Provider implementations use this
 * to honour cancellation while simulating work.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
