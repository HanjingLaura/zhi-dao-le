import test from "node:test";
import assert from "node:assert/strict";
import {
  formatJdText,
  isMeaningfulJd,
  normalizeStructuredJd,
  paginateJd
} from "../src/lib/jd.js";
import {
  buildModeInstruction,
  isSparseJd,
  structureJd
} from "../server/bailian.js";

test("按固定顺序导出岗位纯文本并省略不可信链接", () => {
  const result = formatJdText({
    company: "测试公司",
    companyUrl: "https://example.com",
    companyUrlConfidence: "low",
    role: "平台工程师",
    locations: ["北京", "上海"],
    summary: "负责平台建设。",
    responsibilities: ["设计核心服务。", "推动项目交付。"],
    requirements: ["熟悉 Go。"],
    bonusPoints: ["熟悉 Kubernetes。"]
  });

  assert.equal(result.includes("公司官网或相关链接"), false);
  assert.match(result, /公司：测试公司[\s\S]*岗位：平台工程师[\s\S]*Base：北京、上海/);
  assert.match(result, /岗位职责：\n1\. 设计核心服务。\n2\. 推动项目交付。/);
  assert.match(result, /岗位要求：\n1\. 熟悉 Go。/);
  assert.match(result, /加分项：\n1\. 熟悉 Kubernetes。/);
});

test("适度润色识别极简 JD 并限制扩写边界", () => {
  const rawJd = `某搜索公司招聘爬虫专家，Base 北京。
必须有专业爬虫或数据采集开发经验。
要求覆盖 Web/App 多端数据获取和大型爬虫系统。
有通爬能力优先。`;
  const instruction = buildModeInstruction("polished", rawJd);

  assert.equal(isSparseJd(rawJd), true);
  assert.match(instruction, /极简 JD/);
  assert.match(instruction, /“必须、需要、要求”归入 requirements/);
  assert.match(instruction, /“优先、加分、目标公司背景”归入 bonusPoints/);
  assert.match(instruction, /不要因此只做机械复述/);
  assert.match(instruction, /使用 2-3 个完整句子/);
  assert.match(instruction, /requirements 可以按能力域逐项拆分/);
  assert.match(instruction, /优先生成 3-4 条高信息密度的 responsibilities/);
  assert.match(instruction, /responsibilities 不要变成一个关键词一条的短标签/);
  assert.match(instruction, /中性连接词让表达完整自然/);
  assert.match(instruction, /不得新增年限、学历、薪资/);
  assert.match(instruction, /不得写“大模型训练数据”/);
  assert.match(instruction, /不得自行列举算法、数据、平台等团队/);
  assert.match(instruction, /不得自动增加方案设计、实施、建设、开发、迭代、运维、落地或保障结果/);
});

test("清理 Markdown 并规范化列表字段", () => {
  const result = normalizeStructuredJd({
    companyName: "**示例公司**",
    jobTitle: "# 算法工程师",
    base: "北京；上海",
    duties: ["**负责模型训练**", "- 推进部署"],
    qualifications: "熟悉 Python\n具备工程经验"
  });

  assert.equal(result.company, "示例公司");
  assert.equal(result.role, "算法工程师");
  assert.deepEqual(result.locations, ["北京", "上海"]);
  assert.deepEqual(result.responsibilities, ["负责模型训练", "推进部署"]);
  assert.equal(isMeaningfulJd(result), true);
});

test("较长 JD 自动分页且不丢失条目", () => {
  const data = normalizeStructuredJd({
    company: "测试公司",
    role: "高级工程师",
    responsibilities: Array.from(
      { length: 10 },
      (_, index) =>
        `负责第 ${index + 1} 个业务模块的架构设计、核心功能实现、跨团队交付、线上稳定性建设及持续迭代优化。`
    ),
    requirements: Array.from(
      { length: 8 },
      (_, index) =>
        `具备第 ${index + 1} 类复杂系统的设计开发、性能优化、线上问题排查与跨团队项目协作经验。`
    )
  });
  const pages = paginateJd(data);
  const itemCount = pages
    .flatMap((page) => page.sections)
    .reduce((count, section) => count + section.items.length, 0);

  assert.ok(pages.length > 1);
  assert.ok(pages.length <= 2);
  assert.equal(itemCount, 18);
});

test("常规完整 JD 优先排在一张卡片", () => {
  const pages = paginateJd({
    company: "测试公司",
    role: "高级后端工程师",
    locations: ["北京", "上海"],
    summary: "负责企业级平台产品建设，推动核心能力稳定交付。",
    responsibilities: [
      "负责服务平台核心模块的设计与开发。",
      "建设任务调度与服务治理能力。",
      "与算法及产品团队协作推动项目落地。",
      "持续提升系统稳定性。"
    ],
    requirements: [
      "熟练使用 Python 或 Go。",
      "具备微服务或云原生平台经验。",
      "具有良好的沟通与问题排查能力。"
    ],
    bonusPoints: ["熟悉 Kubernetes。", "具有 AI 平台项目经验。"],
    companyIntroduction: "团队专注企业级 AI 基础设施产品。"
  });

  assert.equal(pages.length, 1);
});

test("模拟模型路径返回可渲染的完整 JD", async () => {
  const previous = process.env.MOCK_AI;
  process.env.MOCK_AI = "true";
  try {
    const result = await structureJd({ rawJd: "一段用于测试的岗位描述", mode: "faithful" });
    assert.equal(result.role, "高级后端工程师");
    assert.ok(result.responsibilities.length >= 3);
    assert.equal(isMeaningfulJd(result), true);
  } finally {
    if (previous === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = previous;
  }
});

test("勾选联网搜索后仅保留高置信度链接", async () => {
  const previous = process.env.MOCK_AI;
  process.env.MOCK_AI = "true";
  try {
    const withoutSearch = await structureJd({
      rawJd: "测试科技公司招聘后端工程师，工作地点北京。",
      mode: "faithful",
      searchOfficialLink: false
    });
    const withSearch = await structureJd({
      rawJd: "测试科技公司招聘后端工程师，工作地点北京。",
      mode: "faithful",
      searchOfficialLink: true
    });

    assert.equal(withoutSearch.companyUrl, "");
    assert.equal(withSearch.companyUrl, "https://example.com/");
    assert.equal(withSearch.companyUrlConfidence, "high");
    assert.equal(withSearch.companyUrlSource, "search");
  } finally {
    if (previous === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = previous;
  }
});
