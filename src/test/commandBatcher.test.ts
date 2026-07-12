import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandBatcher, MoveRequest } from '../commandBatcher';

test('deduplicates requests by motor and keeps the latest target', async () => {
  const sent: MoveRequest[][] = [];
  const batcher = new CommandBatcher(async requests => {
    sent.push(requests);
  }, { debounceMs: 10000, maxWaitMs: 10000 });

  batcher.queue({ motorId: '1', targetPosition: 0, requiresMove: true });
  batcher.queue({ motorId: '1', targetPosition: 100, requiresMove: false });
  batcher.queue({ motorId: '2', targetPosition: 50, requiresMove: true });
  await batcher.flushNow();

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], [
    { motorId: '1', targetPosition: 100, requiresMove: false },
    { motorId: '2', targetPosition: 50, requiresMove: true },
  ]);
});

test('retries a failed controller send once', async () => {
  let attempts = 0;
  const batcher = new CommandBatcher(async () => {
    attempts++;
    if (attempts === 1) {
      throw new Error('temporary controller failure');
    }
  }, {
    debounceMs: 10000,
    maxWaitMs: 10000,
    retryDelayMs: 0,
    maxRetries: 1,
  });

  batcher.queue({ motorId: '1', targetPosition: 100, requiresMove: true });
  await batcher.flushNow();

  assert.equal(attempts, 2);
});

test('serializes a second batch queued during an in-flight send', async () => {
  const sent: string[][] = [];
  let releaseFirstSend: (() => void) | undefined;
  const firstSendBlocked = new Promise<void>(resolve => {
    releaseFirstSend = resolve;
  });
  const batcher = new CommandBatcher(async requests => {
    sent.push(requests.map(request => request.motorId));
    if (sent.length === 1) {
      await firstSendBlocked;
    }
  }, { debounceMs: 10000, maxWaitMs: 10000 });

  batcher.queue({ motorId: '1', targetPosition: 100, requiresMove: true });
  const firstFlush = batcher.flushNow();
  await new Promise(resolve => setTimeout(resolve, 0));
  batcher.queue({ motorId: '2', targetPosition: 100, requiresMove: true });
  releaseFirstSend?.();
  await firstFlush;
  await batcher.flushNow();

  assert.deepEqual(sent, [['1'], ['2']]);
});
