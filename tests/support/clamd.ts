import { createServer, type Server, type Socket } from 'node:net';

// A stand-in for clamd, enough to test the INSTREAM connector (src/lib/antivirus.ts) without installing ClamAV: it
// reads the command, the length-prefixed chunks and the zero-length end, and answers as clamd does.

/**
 * The EICAR test file, which every antivirus reports as "Eicar-Test-Signature" and which harms nothing. Built from two
 * halves so that no file of the repository holds it whole (a workstation's antivirus would quarantine it).
 */
export const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

/**
 * normal: "stream: OK", or "stream: Eicar-Test-Signature FOUND" for a stream that holds EICAR; error: an error reply;
 * silent: never answers; limit: answers that the stream is beyond StreamMaxLength after its first chunk, and closes;
 * exceeds: answers as clamd with AlertExceedsMax does for a file beyond MaxFileSize.
 */
export type ClamdMode = 'normal' | 'error' | 'silent' | 'limit' | 'exceeds';

export type FakeClamd = {
  /** What CODEX_CLAMD takes: host:port, or the socket's path. */
  address: string;
  /** Commands received, and the bytes of each stream once complete. */
  commands: string[];
  streams: Buffer[];
  mode: ClamdMode;
  close(): Promise<void>;
};

function serve(state: FakeClamd, sock: Socket) {
  let buf = Buffer.alloc(0);
  let command: string | null = null;
  const parts: Buffer[] = [];
  const reply = (text: string) => {
    sock.end(`${text}\0`);
  };
  sock.on('error', () => {});
  sock.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (command === null) {
      const end = buf.indexOf(0);
      if (end < 0) return;
      command = buf.subarray(0, end).toString('latin1');
      state.commands.push(command);
      buf = buf.subarray(end + 1);
      if (command !== 'zINSTREAM') return reply('UNKNOWN COMMAND');
    }
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len === 0) {
        const stream = Buffer.concat(parts);
        state.streams.push(stream);
        if (state.mode === 'silent') return;
        if (state.mode === 'error') return reply('Can\'t allocate memory ERROR');
        if (state.mode === 'exceeds') return reply('stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND');
        return reply(stream.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK');
      }
      if (buf.length < 4 + len) return;
      parts.push(buf.subarray(4, 4 + len));
      buf = buf.subarray(4 + len);
      if (state.mode === 'limit') return reply('INSTREAM size limit exceeded. ERROR');
    }
  });
}

/** Starts a fake clamd on a free local TCP port, or on the Unix socket `path`. */
export async function fakeClamd(mode: ClamdMode = 'normal', path?: string): Promise<FakeClamd> {
  const sockets = new Set<Socket>();
  const state: FakeClamd = { address: '', commands: [], streams: [], mode, close: async () => {} };
  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    serve(state, sock);
  });
  await new Promise<void>((resolve) => (path ? server.listen(path, resolve) : server.listen(0, '127.0.0.1', resolve)));
  const at = server.address();
  state.address = typeof at === 'string' ? at : `127.0.0.1:${at!.port}`;
  state.close = () => new Promise<void>((resolve) => {
    for (const s of sockets) s.destroy();
    server.close(() => resolve());
  });
  return state;
}

/** An address where nothing listens: a port just released. */
export async function deadAddress(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `127.0.0.1:${port}`;
}
