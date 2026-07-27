import { Socket } from 'node:net';

import {
  buildCommandFrame,
  buildStatusRequest,
  decodeStatus,
  type AcState,
} from './protocol.js';

export class SkyworthClient {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  public async getStatus(): Promise<AcState> {
    const response = await this.request(buildStatusRequest(), true);
    return decodeStatus(response);
  }

  public async setState(
    data1: number,
    data2: number,
    data3: number,
    data4: number,
  ): Promise<void> {
    await this.request(buildCommandFrame(data1, data2, data3, data4), false);
  }

  private request(frame: Buffer, expectReply: boolean): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let receivedLength = 0;
      let settled = false;

      const finish = (error?: Error, response: Buffer = Buffer.alloc(0)): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      };

      socket.setTimeout(this.timeoutMs);
      socket.once('timeout', () => {
        finish(new Error(`Timed out connecting to ${this.host}:${this.port}`));
      });
      socket.once('error', (error) => {
        finish(error);
      });
      socket.once('close', () => {
        if (expectReply && !settled) {
          finish(new Error(`Connection to ${this.host}:${this.port} closed before a complete response`));
        }
      });
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        receivedLength += chunk.length;

        const response = Buffer.concat(chunks, receivedLength);
        const declaredLength = response[4];
        if (declaredLength !== undefined && response.length >= declaredLength) {
          finish(undefined, response.subarray(0, declaredLength));
        }
      });

      socket.connect(this.port, this.host, () => {
        if (expectReply) {
          socket.write(frame);
        } else {
          socket.end(frame, () => {
            finish();
          });
        }
      });
    });
  }
}
