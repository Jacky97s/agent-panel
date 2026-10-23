import type { Plugin } from 'vite';
import { type AgentServerOptions, createAgentServer } from './server.js';

export function agentPanel(options: Omit<AgentServerOptions, 'cwd'> & { cwd?: string }): Plugin {
  return {
    name: 'agent-panel',
    configureServer(server) {
      const agent = createAgentServer({
        ...options,
        cwd: options.cwd ?? server.config.root,
      });
      server.middlewares.use(agent.middleware());
      const httpServer = server.httpServer;
      if (httpServer && 'maxHeadersCount' in httpServer) {
        agent.attach(httpServer);
        httpServer.on('close', () => {
          void agent.close();
        });
      }
    },
  };
}
