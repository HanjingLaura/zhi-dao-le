import test from "node:test";
import assert from "node:assert/strict";
import { apiPath, postJson } from "../src/lib/api.js";

test("Vercel 子路径 API 保留尾斜杠，避免父站点 308 POST", () => {
  assert.equal(apiPath("structure-jd", "/zhidaole"), "/zhidaole/api/structure-jd/");
  assert.equal(apiPath("/revise-jd/", "/zhidaole/"), "/zhidaole/api/revise-jd/");
});

test("本地开发使用无尾斜杠的根路径 API", () => {
  assert.equal(apiPath("structure-jd", ""), "/api/structure-jd");
  assert.equal(apiPath("/health/", ""), "/api/health");
});

test("把浏览器 Failed to fetch 转成可读错误", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    await assert.rejects(
      () => postJson("/zhidaole/api/structure-jd/", { rawJd: "test" }),
      (error) => {
        assert.equal(error.message, "网络连接失败，请稍后重试");
        assert.equal(error.code, "network_error");
        return true;
      }
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("透传服务端返回的业务错误", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "请粘贴更完整的岗位信息", code: "raw_jd_too_short" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });

  try {
    await assert.rejects(
      () => postJson("/api/structure-jd", { rawJd: "hi" }),
      (error) => {
        assert.equal(error.message, "请粘贴更完整的岗位信息");
        assert.equal(error.code, "raw_jd_too_short");
        return true;
      }
    );
  } finally {
    globalThis.fetch = previous;
  }
});
