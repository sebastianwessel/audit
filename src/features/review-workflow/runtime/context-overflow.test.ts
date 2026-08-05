import { expect, test } from 'bun:test';
import { ModelError } from '@purista/harness';
import { sha256 } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import {
  type ContextOverflowTopologyEvent,
  contextOverflowRecoveryProtocolFingerprint,
  isContextLengthExceeded,
  recoverFromContextOverflow,
} from './context-overflow.js';

const contextOverflow = () =>
  new ModelError('The provider rejected the context.', {
    provider: 'test',
    model: 'test-model',
    method: 'object',
    reason: 'context_length_exceeded',
  });

const phaseInputFingerprint = '0'.repeat(64);

function contextDocument(body: string): ContextDocument {
  return {
    path: 'architecture.md',
    title: 'Architecture',
    kind: 'architecture',
    sensitivity: 'internal',
    appliesTo: ['**/*'],
    body,
    digest: sha256(`architecture.md\0Architecture\0architecture\0internal\0**/*\0${body}`),
  };
}

test('recognizes only the normalized provider context-window error', () => {
  expect(isContextLengthExceeded(contextOverflow())).toBe(true);
  expect(
    isContextLengthExceeded(
      new ModelError('Network error', {
        provider: 'test',
        model: 'test-model',
        method: 'object',
        reason: 'network',
      }),
    ),
  ).toBe(false);
});

test('runs the full scope first and splits only after a context-window rejection', async () => {
  const calls: string[][] = [];
  const recovered: string[] = [];
  const result = await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['z.unknown', 'a.unknown', 'm.unknown', 'b.unknown'],
    invoke: async (scope) => {
      calls.push([...scope.sourcePaths]);
      if (scope.sourcePaths.length > 2) throw contextOverflow();
      return scope.sourcePaths.join(',');
    },
    reduce: (leaves) => leaves.map((leaf) => leaf.output).join('|'),
    onRecoveredFailure: () => recovered.push('context-overflow'),
  });

  expect(calls).toEqual([
    ['a.unknown', 'b.unknown', 'm.unknown', 'z.unknown'],
    ['a.unknown', 'b.unknown'],
    ['m.unknown', 'z.unknown'],
  ]);
  expect(result).toBe('a.unknown,b.unknown|m.unknown,z.unknown');
  expect(recovered).toEqual(['context-overflow']);
});

test('recovers one oversized source only after provider rejection by splitting line ranges', async () => {
  const calls: string[] = [];
  const result = await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['large.unknown'],
    invoke: async (scope) => {
      const range = scope.lineRanges[0];
      calls.push(range === undefined ? 'whole-file' : `${range.startLine}-${range.endLine}`);
      if (range === undefined) throw contextOverflow();
      return String(range.startLine);
    },
    splitSingleton: async (path) => [
      {
        sourcePaths: [path],
        lineRanges: [{ path, startLine: 1, endLine: 50 }],
        context: [],
      },
      {
        sourcePaths: [path],
        lineRanges: [{ path, startLine: 51, endLine: 100 }],
        context: [],
      },
    ],
    reduce: (leaves) => leaves.map((leaf) => leaf.output).join(','),
  });

  expect(calls).toEqual(['whole-file', '1-50', '51-100']);
  expect(result).toBe('1,51');
});

test('reuses only a provider-confirmed overflow parent topology after an explicit restart', async () => {
  const events: ContextOverflowTopologyEvent[] = [];
  await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['a.unknown', 'b.unknown'],
    invoke: async (scope) => {
      if (scope.sourcePaths.length === 2) throw contextOverflow();
      return scope.sourcePaths.join(',');
    },
    reduce: (leaves) => leaves.map((leaf) => leaf.output).join('|'),
    onTopologyTransition: async (event) => {
      events.push(event);
    },
  });
  const rootScopeFingerprint = events.find((event) => event.childKey === 'root')?.scopeFingerprint;
  if (rootScopeFingerprint === undefined) throw new Error('Expected root recovery topology.');
  const resumedCalls: string[][] = [];
  const result = await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['a.unknown', 'b.unknown'],
    priorTopology: {
      phaseInputFingerprint,
      recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
      rootScopeFingerprint,
      events,
    },
    invoke: async (scope) => {
      resumedCalls.push([...scope.sourcePaths]);
      return scope.sourcePaths.join(',');
    },
    reduce: (leaves) => leaves.map((leaf) => leaf.output).join('|'),
  });

  expect(resumedCalls).toEqual([['a.unknown'], ['b.unknown']]);
  expect(result).toBe('a.unknown|b.unknown');
});

test('reuses a completed child only when its exact validated artifact and topology agree', async () => {
  const events: ContextOverflowTopologyEvent[] = [];
  const leaves: Array<{ childKey: string; scopeFingerprint: string; output: string }> = [];
  await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['a.unknown', 'b.unknown'],
    invoke: async (scope) => {
      if (scope.sourcePaths.length === 2) throw contextOverflow();
      return scope.sourcePaths.join(',');
    },
    reduce: (recovered) => recovered.map((leaf) => leaf.output).join('|'),
    onRecoveredLeafCompleted: async (leaf) => {
      leaves.push({
        childKey: leaf.childKey,
        scopeFingerprint: leaf.scopeFingerprint,
        output: leaf.output,
      });
    },
    onTopologyTransition: async (event) => {
      events.push(event);
    },
  });
  const rootScopeFingerprint = events.find((event) => event.childKey === 'root')?.scopeFingerprint;
  if (rootScopeFingerprint === undefined) throw new Error('Expected root recovery topology.');
  const calls: string[][] = [];
  const result = await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['a.unknown', 'b.unknown'],
    priorTopology: {
      phaseInputFingerprint,
      recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
      rootScopeFingerprint,
      events,
    },
    priorRecoveredLeaves: leaves.filter((leaf) => leaf.childKey === 'root/left'),
    invoke: async (scope) => {
      calls.push([...scope.sourcePaths]);
      return scope.sourcePaths.join(',');
    },
    reduce: (recovered) => recovered.map((leaf) => leaf.output).join('|'),
  });

  expect(calls).toEqual([['b.unknown']]);
  expect(result).toBe('a.unknown|b.unknown');
});

test('rejects a mismatched persisted overflow topology before another provider call', async () => {
  let invoked = false;
  await expect(
    recoverFromContextOverflow({
      phaseInputFingerprint,
      sourcePaths: ['a.unknown'],
      priorTopology: {
        phaseInputFingerprint,
        recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
        rootScopeFingerprint: 'a'.repeat(64),
        events: [],
      },
      invoke: async () => {
        invoked = true;
        return 'unreachable';
      },
      reduce: () => 'unreachable',
    }),
  ).rejects.toMatchObject({ code: 'artifact-invalid' });
  expect(invoked).toBe(false);
});

test('rejects a topology from a different phase input before another provider call', async () => {
  let invoked = false;
  await expect(
    recoverFromContextOverflow({
      phaseInputFingerprint,
      sourcePaths: ['a.unknown'],
      priorTopology: {
        phaseInputFingerprint: '1'.repeat(64),
        recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
        rootScopeFingerprint: 'a'.repeat(64),
        events: [],
      },
      invoke: async () => {
        invoked = true;
        return 'unreachable';
      },
      reduce: () => 'unreachable',
    }),
  ).rejects.toMatchObject({ code: 'artifact-invalid' });
  expect(invoked).toBe(false);
});

test('recovers a provider-rejected optional context without dropping its content', async () => {
  const calls: string[] = [];
  const body = '\n  alpha\r\nbeta\n\ngamma\r\n';
  const result = await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['single-line.unknown'],
    context: [contextDocument(body)],
    splitSingleton: async () => undefined,
    invoke: async (scope) => {
      const received = scope.context.map((document) => document.body).join('|');
      calls.push(received);
      if (calls.length === 1) throw contextOverflow();
      return received;
    },
    reduce: (leaves) => leaves.map((leaf) => leaf.output).join(''),
  });

  expect(calls[0]).toBe(body);
  expect(calls.slice(1).join('')).toBe(body);
  expect(result).toBe(body);
});

test('recovers CR-only optional context without changing its physical bytes', async () => {
  const body = 'alpha\rbeta\rgamma\r';
  const calls: string[] = [];
  const result = await recoverFromContextOverflow({
    phaseInputFingerprint,
    sourcePaths: ['single-line.unknown'],
    context: [contextDocument(body)],
    splitSingleton: async () => undefined,
    invoke: async (scope) => {
      const received = scope.context.map((document) => document.body).join('');
      calls.push(received);
      if (calls.length === 1) throw contextOverflow();
      return received;
    },
    reduce: (leaves) => leaves.map((leaf) => leaf.output).join(''),
  });
  expect(calls[0]).toBe(body);
  expect(calls.slice(1).join('')).toBe(body);
  expect(result).toBe(body);
});

test('fails visibly when an indivisible single-line scope exceeds the provider context', async () => {
  await expect(
    recoverFromContextOverflow({
      phaseInputFingerprint,
      sourcePaths: ['large.unknown'],
      invoke: async () => {
        throw contextOverflow();
      },
      splitSingleton: async () => {
        throw new AuditRuntimeError(
          'provider-context-overflow',
          'The provider context window was exceeded for an indivisible approved source and context scope.',
        );
      },
      reduce: () => 'unreachable',
    }),
  ).rejects.toEqual(
    new AuditRuntimeError(
      'provider-context-overflow',
      'The provider context window was exceeded for an indivisible approved source and context scope.',
    ),
  );
});
