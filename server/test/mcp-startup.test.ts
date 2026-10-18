import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connect, ensureServerRunning, tools } = vi.hoisted(() => ({
  connect: vi.fn(),
  ensureServerRunning: vi.fn(),
  tools: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool(name: string, ...args: unknown[]) { tools.set(name, args.at(-1) as (...args: unknown[]) => unknown); }
    connect = connect;
  },
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class {} }));
vi.mock('../src/ensure-server.js', () => ({ ensureServerRunning }));

beforeEach(() => {
  vi.resetModules();
  connect.mockReset().mockResolvedValue(undefined);
  ensureServerRunning.mockReset();
  tools.clear();
});

describe('MCP startup', () => {
  it('registers tools and connects before starting the HTTP service in the background', async () => {
    ensureServerRunning.mockReturnValue(new Promise<void>(() => {}));
    const { runMcp } = await import('../src/mcp.js');
    await runMcp();
    expect(connect).toHaveBeenCalledOnce();
    expect(tools.has('push_memory')).toBe(true);
    expect(ensureServerRunning).toHaveBeenCalledOnce();
    expect(connect.mock.invocationCallOrder[0]).toBeLessThan(ensureServerRunning.mock.invocationCallOrder[0]);
  });
});
