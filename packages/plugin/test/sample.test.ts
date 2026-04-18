import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { IRDocumentSchema } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('plugin ↔ ir wiring', () => {
  it('resolves the IR package from the plugin and validates sample.json', () => {
    const samplePath = require.resolve('@claude-to-figma/ir/examples/sample.json');
    const raw = JSON.parse(readFileSync(samplePath, 'utf8'));
    const doc = IRDocumentSchema.parse(raw);
    expect(doc.version).toBe(1);
    expect(doc.root.type).toBe('FRAME');
  });
});
