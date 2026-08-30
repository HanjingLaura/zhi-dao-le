import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import {
  createJobFingerprint,
  groupLibraryJobs,
  LEGACY_HISTORY_KEY,
  LEGACY_MIGRATION_KEY,
  openJobLibrary,
  searchLibraryJobs
} from "../src/lib/job-library.js";

const record = ({ id, company, role, locations = ["上海"], rawJd = "" }) => ({
  id,
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  lastOpenedAt: "2026-08-29T10:00:00.000Z",
  rawJd,
  data: {
    libraryCompany: company,
    libraryRole: role,
    company,
    role,
    locations,
    summary: "负责云原生平台建设。",
    responsibilities: ["建设 Kubernetes 平台能力。"],
    requirements: ["具备后端工程经验。"],
    bonusPoints: []
  }
});

test("岗位指纹兼容 Unicode、换行和无意义空白", async () => {
  const first = await createJobFingerprint({
    rawJd: "光轮智能  \r\n后端工程师\n\n\nBase 上海",
    mode: "polished"
  });
  const second = await createJobFingerprint({
    rawJd: "光轮智能\n后端工程师\n\nBase 上海",
    mode: "polished"
  });
  assert.equal(first, second);
});

test("岗位指纹区分正文与模式，保密模式忽略联网开关", async () => {
  const base = { rawJd: "光轮智能，后端工程师，Base 上海" };
  assert.notEqual(
    await createJobFingerprint({ ...base, mode: "faithful" }),
    await createJobFingerprint({ ...base, mode: "polished" })
  );
  assert.notEqual(
    await createJobFingerprint({ ...base, mode: "polished" }),
    await createJobFingerprint({
      ...base,
      mode: "polished",
      searchOfficialLink: true
    })
  );
  assert.equal(
    await createJobFingerprint({ ...base, mode: "confidential" }),
    await createJobFingerprint({
      ...base,
      mode: "confidential",
      searchOfficialLink: true
    })
  );
});

test("岗位库按内部公司名分类，不依赖保密卡片显示名", () => {
  const privateJob = record({
    id: "1",
    company: "光轮智能",
    role: "后端工程师"
  });
  privateJob.data.company = "保密科技公司";
  const items = [
    privateJob,
    record({ id: "2", company: "光轮智能", role: "数据平台工程师" }),
    record({ id: "3", company: "星河科技", role: "前端工程师" })
  ];
  const groups = groupLibraryJobs(items);
  assert.equal(groups.length, 2);
  assert.equal(
    groups.find((group) => group.company === "光轮智能")?.jobs.length,
    2
  );
});

test("岗位库能搜索公司、岗位、Base、技能词和原始 JD", () => {
  const items = [
    record({
      id: "1",
      company: "光轮智能",
      role: "云原生后端工程师",
      rawJd: "负责模型服务稳定性建设"
    }),
    record({
      id: "2",
      company: "星河科技",
      role: "前端工程师",
      locations: ["北京"]
    })
  ];
  assert.equal(searchLibraryJobs(items, "光轮 上海").length, 1);
  assert.equal(searchLibraryJobs(items, "Kubernetes 光轮").length, 1);
  assert.equal(searchLibraryJobs(items, "模型服务").length, 1);
  assert.equal(searchLibraryJobs(items, "北京")[0].id, "2");
  assert.equal(searchLibraryJobs(items, "不存在").length, 0);
});

test("IndexedDB 岗位库支持精确命中、原位修改、删除与恢复", async () => {
  const library = openJobLibrary({
    indexedDB: new IDBFactory(),
    dbName: `job-library-${crypto.randomUUID()}`
  });
  const input = {
    rawJd: "光轮智能  \n云原生后端工程师\nBase 上海",
    mode: "confidential",
    searchOfficialLink: true
  };
  const saved = await library.saveGenerated({
    ...input,
    data: record({
      id: "source",
      company: "光轮智能",
      role: "云原生后端工程师"
    }).data
  });

  const hit = await library.findExact({
    ...input,
    rawJd: "光轮智能\n云原生后端工程师\nBase 上海",
    searchOfficialLink: false
  });
  assert.equal(hit?.id, saved.id);

  const updated = await library.update(saved.id, {
    data: {
      ...saved.data,
      locations: ["上海", "杭州"],
      summary: "负责云原生平台核心能力建设与稳定交付。"
    }
  });
  assert.equal(updated.id, saved.id);
  assert.equal(updated.fingerprint, saved.fingerprint);
  assert.deepEqual(updated.data.locations, ["上海", "杭州"]);
  assert.equal((await library.findExact(input))?.data.locations.length, 2);

  const removed = await library.remove(saved.id);
  assert.equal(removed?.id, saved.id);
  assert.equal(await library.findExact(input), null);
  await library.put(removed);
  assert.equal((await library.findExact(input))?.id, saved.id);
});

test("旧历史迁移时同一输入保留最新结果且只迁移一次", async () => {
  const library = openJobLibrary({
    indexedDB: new IDBFactory(),
    dbName: `job-library-${crypto.randomUUID()}`
  });
  const values = new Map([
    [
      LEGACY_HISTORY_KEY,
      JSON.stringify([
        {
          id: "newer",
          rawJd: "光轮智能招聘后端工程师",
          mode: "faithful",
          createdAt: "2026-08-29T10:00:00.000Z",
          data: record({
            id: "newer",
            company: "光轮智能",
            role: "高级后端工程师"
          }).data
        },
        {
          id: "older",
          rawJd: "光轮智能招聘后端工程师",
          mode: "faithful",
          createdAt: "2026-08-28T10:00:00.000Z",
          data: record({
            id: "older",
            company: "光轮智能",
            role: "后端工程师"
          }).data
        }
      ])
    ]
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  const first = await library.migrateLegacy(storage);
  const second = await library.migrateLegacy(storage);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].data.libraryRole, "高级后端工程师");
  assert.equal(values.has(LEGACY_HISTORY_KEY), false);
  assert.equal(values.get(LEGACY_MIGRATION_KEY), "1");
});

test("浏览器拒绝 localStorage 时仍可正常使用 IndexedDB 岗位库", async () => {
  const library = openJobLibrary({
    indexedDB: new IDBFactory(),
    dbName: `job-library-${crypto.randomUUID()}`
  });
  const blockedStorage = {
    getItem() {
      throw new DOMException("Blocked", "SecurityError");
    }
  };

  assert.deepEqual(await library.migrateLegacy(blockedStorage), []);
  const saved = await library.saveGenerated({
    rawJd: "光轮智能招聘后端工程师",
    mode: "confidential",
    data: record({
      id: "source",
      company: "光轮智能",
      role: "后端工程师"
    }).data
  });
  assert.equal(saved.data.libraryCompany, "光轮智能");
  assert.equal(saved.data.company, "保密公司");
  assert.equal((await library.list()).length, 1);
});

test("并发保存与访问不会覆盖同一岗位的最新修改", async () => {
  const library = openJobLibrary({
    indexedDB: new IDBFactory(),
    dbName: `job-library-${crypto.randomUUID()}`
  });
  const input = {
    rawJd: "星河科技招聘前端工程师，Base 北京",
    mode: "faithful",
    searchOfficialLink: false
  };
  const baseData = record({
    id: "source",
    company: "星河科技",
    role: "前端工程师",
    locations: ["北京"]
  }).data;

  await Promise.all([
    library.saveGenerated({ ...input, data: { ...baseData, summary: "第一版" } }),
    library.saveGenerated({ ...input, data: { ...baseData, summary: "第二版" } })
  ]);
  const [saved] = await library.list();
  assert.equal((await library.list()).length, 1);
  assert.equal(saved.revision, 2);

  await Promise.all([
    library.update(saved.id, {
      data: { ...saved.data, summary: "人工确认后的最终版本" }
    }),
    library.touch(saved.id, "2026-08-30T12:00:00.000Z")
  ]);
  assert.equal((await library.get(saved.id)).data.summary, "人工确认后的最终版本");
});
