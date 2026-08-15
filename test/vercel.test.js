import test from "node:test";
import assert from "node:assert/strict";

process.env.VERCEL = "1";

const { restoreApiUrl } = await import("../api/index.js");

test("还原 Vercel 重写后的职到了 API 路径", () => {
  const request = {
    headers: { host: "hanjing-laura.vercel.app" },
    url: "/api/index?__zhidaole_path=structure-jd"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/structure-jd");
});

test("清理微前端重写参数并保留原始查询参数", () => {
  const request = {
    headers: { host: "hanjing-laura.vercel.app" },
    url: "/zhidaole/api/health?__zhidaole_path=health&path=health&source=check"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/health?source=check");
});

test("不改写未经过 Vercel 路由的请求", () => {
  const request = {
    headers: { host: "localhost" },
    url: "/api/health"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/health");
});
