import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

export type ExternalCommandAction = 'open' | 'close' | 'stop';

export interface ExternalCommandRequest {
  version: 1;
  requestId: string;
  sessionId: string;
  source: string;
  label: string;
  action: ExternalCommandAction;
  motorIds: number[];
}

export interface ExternalCommandResult {
  accepted: true;
  controller: string;
  requestId: string;
  sessionId: string;
  action: ExternalCommandAction;
  mode: 'group' | 'mixed' | 'motors';
  groupIds: number[];
  motorIds: string[];
  deduplicated?: boolean;
}

export interface ExternalCommandApiLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export class ExternalCommandError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export class ExternalCommandApi {
  private server?: Server;

  constructor(
    private readonly port: number,
    private readonly token: string,
    private readonly logger: ExternalCommandApiLogger,
    private readonly handler: (request: ExternalCommandRequest) => Promise<ExternalCommandResult>,
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, '127.0.0.1');
    });

    this.logger.info(`Silent Gliss local command API listening on 127.0.0.1:${this.port}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) {
      return;
    }

    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  getListeningPort(): number | undefined {
    const address = this.server?.address();
    return typeof address === 'object' && address ? address.port : undefined;
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/commands') {
        throw new ExternalCommandError(404, 'not found');
      }

      if (this.token && request.headers.authorization !== `Bearer ${this.token}`) {
        throw new ExternalCommandError(401, 'unauthorized');
      }

      const body = await this.readBody(request);
      const command = this.validateRequest(JSON.parse(body) as unknown);
      const result = await this.handler(command);
      this.writeJson(response, 200, result);
    } catch (error) {
      const statusCode = error instanceof ExternalCommandError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (statusCode >= 500) {
        this.logger.warn(`Silent Gliss local command API request failed: ${message}`);
      }
      this.writeJson(response, statusCode, { accepted: false, error: message });
    }
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > 32768) {
        throw new ExternalCommandError(413, 'request body too large');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private validateRequest(value: unknown): ExternalCommandRequest {
    if (!value || typeof value !== 'object') {
      throw new ExternalCommandError(400, 'request must be a JSON object');
    }

    const request = value as Partial<ExternalCommandRequest>;
    const validAction = request.action === 'open' || request.action === 'close' || request.action === 'stop';
    const validMotors = Array.isArray(request.motorIds) && request.motorIds.length > 0 &&
      request.motorIds.every(motorId => Number.isInteger(motorId) && motorId > 0);
    if (request.version !== 1 || !validAction || !validMotors ||
      typeof request.requestId !== 'string' || request.requestId.length < 1 || request.requestId.length > 160 ||
      typeof request.sessionId !== 'string' || request.sessionId.length < 1 || request.sessionId.length > 160 ||
      typeof request.source !== 'string' || request.source.length < 1 || request.source.length > 80 ||
      typeof request.label !== 'string' || request.label.length < 1 || request.label.length > 120) {
      throw new ExternalCommandError(400, 'invalid Silent Gliss command request');
    }

    return {
      version: 1,
      requestId: request.requestId,
      sessionId: request.sessionId,
      source: request.source,
      label: request.label,
      action: request.action as ExternalCommandAction,
      motorIds: Array.from(new Set(request.motorIds)),
    };
  }

  private writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    if (response.headersSent) {
      return;
    }
    const body = `${JSON.stringify(value)}\n`;
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    response.end(body);
  }
}
