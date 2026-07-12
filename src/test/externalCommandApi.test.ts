import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import {
  ExternalCommandApi,
  ExternalCommandRequest,
  ExternalCommandResult,
} from '../externalCommandApi';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function post(port: number, token: string, value: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(value);
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/v1/commands',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('local command API authenticates and validates physical switch commands', async () => {
  const handled: ExternalCommandRequest[] = [];
  const api = new ExternalCommandApi(0, 'test-token-123456', logger, async command => {
    handled.push(command);
    return {
      accepted: true,
      controller: '192.168.70.2',
      requestId: command.requestId,
      sessionId: command.sessionId,
      action: command.action,
      mode: 'group',
      groupIds: [2],
      motorIds: [],
    } satisfies ExternalCommandResult;
  });
  await api.start();
  const port = api.getListeningPort()!;

  try {
    const invalidToken = await post(port, 'wrong-token', {});
    assert.equal(invalidToken.status, 401);

    const invalidCommand = await post(port, 'test-token-123456', { action: 'wiggle' });
    assert.equal(invalidCommand.status, 400);

    const command: ExternalCommandRequest = {
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      source: 'wandsworth',
      label: 'Study Romans',
      action: 'stop',
      motorIds: [5, 6, 6],
    };
    const accepted = await post(port, 'test-token-123456', command);
    assert.equal(accepted.status, 200);
    assert.deepEqual(handled[0].motorIds, [5, 6]);
    assert.deepEqual((accepted.body as ExternalCommandResult).groupIds, [2]);
  } finally {
    await api.stop();
  }
});
