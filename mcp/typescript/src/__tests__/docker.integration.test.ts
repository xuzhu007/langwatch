import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isDockerAvailable,
  removeDockerContainer,
  startDockerContainer,
} from "./helpers/docker-setup";

const IMAGE_NAME = "langwatch-mcp-server-test";
const CONTAINER_NAME = "langwatch-mcp-server-test-container";
const HOST_PORT = 13099; // unlikely to conflict

/**
 * HTTP mode verifies the bearer against the LangWatch API before creating a
 * session, so the authenticated paths need a key the API actually accepts.
 * Without one, this file still covers startup, CORS, and rejection.
 */
const BEARER_TOKEN = process.env.LANGWATCH_API_KEY;

/** A syntactically fine token that the LangWatch API does not know. */
const BOGUS_TOKEN = "totally-not-a-real-key";

/** Standard headers required by the MCP Streamable HTTP protocol */
const MCP_POST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

describe.skipIf(!isDockerAvailable())("Docker container", () => {

  beforeAll(async () => {
    try {
      await startDockerContainer({
        imageName: IMAGE_NAME,
        containerName: CONTAINER_NAME,
        hostPort: HOST_PORT,
      });
    } catch (error) {
      removeDockerContainer(CONTAINER_NAME);
      throw error;
    }
  }, 300_000);

  afterAll(() => {
    removeDockerContainer(CONTAINER_NAME);
  });

  // @scenario "镜像包含工作区补丁并正常启动"
  it("health endpoint responds without authentication", async () => {

    const res = await fetch(`http://localhost:${HOST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("does not answer with a wildcard CORS origin", async () => {

    const res = await fetch(`http://localhost:${HOST_PORT}/health`);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("reflects an allowed origin and rejects an unlisted one", async () => {

    const allowed = await fetch(`http://localhost:${HOST_PORT}/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );

    const rejected = await fetch(`http://localhost:${HOST_PORT}/health`, {
      headers: { Origin: "https://attacker.example" },
    });
    expect(rejected.status).toBe(403);
  });

  it("rejects a bearer the LangWatch API does not recognise", async () => {

    const res = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${BOGUS_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it.skipIf(!BEARER_TOKEN)("rejects a session id presented without a bearer token", async () => {

    const initRes = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });
    const sessionId = initRes.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await initRes.text();

    const res = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: { ...MCP_POST_HEADERS, "mcp-session-id": sessionId! },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 on initialize without Bearer token", async () => {

    const res = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: MCP_POST_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authorization");
  });

  it.skipIf(!BEARER_TOKEN)("MCP initialize works with Bearer token", async () => {

    const res = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    // Parse SSE response for the initialize result
    const text = await res.text();
    expect(text).toContain("serverInfo");
  });

  it.skipIf(!BEARER_TOKEN)("lists tools after initialization with Bearer token", async () => {

    // Initialize a session
    const initRes = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    const sessionId = initRes.headers.get("mcp-session-id");

    // Send initialized notification
    await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId!,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    // List tools
    const toolsRes = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId!,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });

    expect(toolsRes.status).toBe(200);
    const toolsText = await toolsRes.text();
    expect(toolsText).toContain("fetch_langwatch_docs");
    expect(toolsText).toContain("search_traces");
  });

  it.skipIf(!BEARER_TOKEN)("legacy SSE endpoint responds with Bearer token", async () => {

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`http://localhost:${HOST_PORT}/sse`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    } catch (error: any) {
      if (error.name !== "AbortError") throw error;
      // AbortError is expected -- SSE stays open
    } finally {
      clearTimeout(timeout);
    }
  });

  it("legacy SSE endpoint returns 401 without token", async () => {

    const res = await fetch(`http://localhost:${HOST_PORT}/sse`);
    expect(res.status).toBe(401);
  });
});
