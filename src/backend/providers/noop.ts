// Noop provider — explicit failure when IMAGE_GEN_PROVIDER is not configured.
// Default for production deployments until a real model is wired in.

import type { ImageGenerationProvider, ProviderInput, ProviderOutput } from './types.js';

export class NoopProvider implements ImageGenerationProvider {
  readonly name = 'noop';

  async generate(_input: ProviderInput): Promise<ProviderOutput> {
    throw new Error(
      'Image generation is not configured. Set IMAGE_GEN_PROVIDER=mock for development, ' +
        'or wire in a real provider (see src/backend/providers/factory.ts).',
    );
  }
}
