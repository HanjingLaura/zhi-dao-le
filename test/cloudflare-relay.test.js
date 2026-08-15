import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../cloudflare-relay/src/index.js";

const env = {
  DASHSCOPE_API_KEY: "dashscope-test-key",
  DASHSCOPE_BASE_URL: "https://dashscope.example/v1",
  RELAY_TOKEN: "relay-test-token"
};

test("Cloudflare 中转拒绝未授权请求", async () => {
  const response = await handleRequest(
    new Request("https://relay.example/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }),
    env,
    () => {
      throw new Error("不应调用百炼");
    }
  );

  assert.equal(response.status, 401);
});

test("Cloudflare 中转注入百炼密钥并返回模型响应", async () => {
  let upstreamRequest;
  const response = await handleRequest(
    new Request("https://relay.example/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zhidaole-Relay-Token": env.RELAY_TOKEN
      },
      body: JSON.stringify({ model: "qwen-plus", messages: [] })
    }),
    env,
    async (url, options) => {
      upstreamRequest = { url, options };
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.url, "https://dashscope.example/v1/chat/completions");
  assert.equal(
    upstreamRequest.options.headers.Authorization,
    `Bearer ${env.DASHSCOPE_API_KEY}`
  );
});
