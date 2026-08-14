import { applyReaderLabReplacements } from '@/lib/reader-lab';

export function createPrecisionReplacementMarkdown(document, explanations) {
  const mappings = (Array.isArray(explanations) ? explanations : [])
    .filter((record) => record.batchAnalysis)
    .flatMap((record) => record.explanation?.mappings || []);

  return applyReaderLabReplacements(document?.content || '', mappings, 'target', 0);
}
