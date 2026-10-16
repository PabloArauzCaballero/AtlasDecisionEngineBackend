import type { SeededRandom } from '../seeded-random';
import { PatternNode } from './types-and-constants';

export function classNode(alphabet: string): PatternNode {
  return { kind: 'class', chars: [...alphabet] };
}

export function emitSequence(
  nodes: readonly PatternNode[],
  random: SeededRandom,
  budget: { left: number },
): string {
  let out = '';
  for (const node of nodes) out += emitNode(node, random, budget);
  return out;
}

function emitNode(node: PatternNode, random: SeededRandom, budget: { left: number }): string {
  if (budget.left <= 0) return '';
  switch (node.kind) {
    case 'literal':
      budget.left -= node.text.length;
      return node.text;
    case 'class':
      budget.left -= 1;
      return random.pick(node.chars);
    case 'group':
      return emitSequence(random.pick(node.alternatives), random, budget);
    case 'repeat': {
      const times = random.int(node.min, node.max);
      let out = '';
      for (let repetition = 0; repetition < times && budget.left > 0; repetition += 1) {
        out += emitNode(node.node, random, budget);
      }
      return out;
    }
  }
}
