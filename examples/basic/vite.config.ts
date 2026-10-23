import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockAgentPath } from '@agent-panel/core/acp';
import { agentPanel } from '@agent-panel/server/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = path.join(root, 'sandbox');
const notePath = path.join(sandbox, 'note.md');
const generatedPath = path.join(sandbox, 'generated.txt');

export default defineConfig({
  plugins: [
    react(),
    agentPanel({
      cwd: root,
      writableRoots: [sandbox],
      agent: { command: process.execPath, args: [mockAgentPath()] },
      capabilities: [
        {
          id: 'note',
          label: 'Markdown note',
          systemPromptAppend: 'Edit the markdown note. Change only what the user asked.',
          writableRoots: [sandbox],
          allowedTools: ['write'],
          buildContext: (ctx) => {
            const lines = [`note path: ${notePath}`];
            if (typeof ctx.selection === 'string' && ctx.selection) {
              lines.push(`Selected text:\n${ctx.selection}`);
            }
            return lines;
          },
        },
        {
          id: 'sandbox-file',
          label: 'Sandbox file',
          systemPromptAppend:
            'Create a text file in the sandbox. Do not write outside that folder.',
          writableRoots: [sandbox],
          allowedTools: ['write'],
          buildContext: () => [`file path: ${generatedPath}`],
        },
      ],
    }),
    filesApi(),
  ],
});

function filesApi(): Plugin {
  const readNote = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/api/note' && req.method === 'GET') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(await fs.readFile(notePath, 'utf8').catch(() => ''));
      return;
    }
    if (url === '/api/note' && req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        void fs.writeFile(notePath, Buffer.concat(chunks)).then(() => res.end('ok'));
      });
      return;
    }
    if (url === '/api/sandbox' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ files: await fs.readdir(sandbox).catch(() => []) }));
      return;
    }
    next();
  };
  return {
    name: 'example-files',
    configureServer(server) {
      server.middlewares.use(readNote);
    },
  };
}
