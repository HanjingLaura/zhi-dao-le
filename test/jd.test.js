import test from "node:test";
import assert from "node:assert/strict";
import {
  MODE_OPTIONS,
  enforceJdMode,
  formatJdText,
  isMeaningfulJd,
  normalizeStructuredJd,
  paginateJd,
  publicJdData
} from "../src/lib/jd.js";
import {
  buildModeInstruction,
  isSparseJd,
  isTransientNetworkError,
  sanitizePolishedJd,
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

test("保密岗位的库内分类名称不会进入导出文字", () => {
  const result = formatJdText({
    libraryCompany: "真实客户公司",
    libraryRole: "内部项目代号岗位",
    company: "保密科技公司",
    role: "后端工程师",
    locations: ["上海"],
    summary: "负责后端平台建设。",
    responsibilities: ["负责核心服务开发。"],
    requirements: ["具备后端工程经验。"]
  });

  assert.equal(result.includes("真实客户公司"), false);
  assert.equal(result.includes("内部项目代号岗位"), false);
  assert.match(result, /公司：保密科技公司[\s\S]*岗位：后端工程师/);
});

test("发给修改接口的公开数据不包含岗位库内部分类", () => {
  const result = publicJdData({
    libraryCompany: "真实客户公司",
    libraryRole: "内部项目代号岗位",
    company: "保密公司",
    role: "后端工程师"
  });

  assert.equal("libraryCompany" in result, false);
  assert.equal("libraryRole" in result, false);
  assert.equal(result.company, "保密公司");
});

test("保密模式会清除人工编辑加入的公司名和链接", () => {
  const result = enforceJdMode(
    {
      libraryCompany: "真实客户公司",
      company: "真实客户公司",
      role: "后端工程师",
      companyUrl: "https://example.com",
      companyUrlConfidence: "high"
    },
    "confidential"
  );

  assert.equal(result.libraryCompany, "真实客户公司");
  assert.equal(result.company, "保密公司");
  assert.equal(result.companyUrl, "");
  assert.equal(result.companyUrlConfidence, "none");
});

test("适度润色将极简输入扩写为通用规范 JD", () => {
  const rawJd = `某搜索公司招聘爬虫专家，Base 北京。
必须有专业爬虫或数据采集开发经验。
要求覆盖 Web/App 多端数据获取和大型爬虫系统。
有通爬能力优先。`;
  const instruction = buildModeInstruction("polished", rawJd);

  assert.equal(isSparseJd(rawJd), true);
  assert.match(instruction, /极简 JD/);
  assert.match(instruction, /只有公司、岗位名称和 Base/);
  assert.match(instruction, /依据岗位类别生成一份偏通用但完整/);
  assert.match(instruction, /“必须、需要、要求”归入 requirements/);
  assert.match(instruction, /“优先、加分、目标公司背景”归入 bonusPoints/);
  assert.match(instruction, /使用 2-3 个完整句子/);
  assert.match(instruction, /responsibilities 通常生成 4-6 条/);
  assert.match(instruction, /requirements 通常生成 4-7 条/);
  assert.match(instruction, /广为人知的主营方向/);
  assert.match(instruction, /不得新增具体年限、学历、薪资/);
  assert.match(instruction, /禁止出现“根据原始 JD”/);
  assert.match(instruction, /“原始 JD 中明确出现的关键词”/);
});

test("适度润色对只有岗位基本信息的输入启用通用补充", () => {
  const instruction = buildModeInstruction(
    "polished",
    "光轮智能，云原生后端工程师，Base 上海"
  );

  assert.equal(isSparseJd("光轮智能，云原生后端工程师，Base 上海"), true);
  assert.match(instruction, /通用职责和通用能力要求/);
  assert.match(instruction, /形成完整 JD/);
  assert.match(instruction, /不声称该公司一定采用某项技术、架构或流程/);
  assert.equal(
    MODE_OPTIONS.find((option) => option.id === "polished")?.description,
    "适合只有岗位基本信息或内容较少的 JD，补充通用职责与要求"
  );
});

test("适度润色成品移除编辑过程话术", () => {
  const result = sanitizePolishedJd({
    company: "光轮智能",
    role: "云原生后端工程师",
    locations: ["上海"],
    summary:
      "根据原始 JD，输入信息有限。负责后端服务的设计、开发与持续优化。",
    responsibilities: [
      "原始 JD 中明确出现的关键词包括后端开发。",
      "负责核心服务的开发、维护与性能优化。"
    ],
    requirements: [
      "建议补充具体年限。",
      "具备良好的工程基础和问题分析能力。"
    ]
  });

  assert.equal(result.summary, "负责后端服务的设计、开发与持续优化。");
  assert.deepEqual(result.responsibilities, [
    "负责核心服务的开发、维护与性能优化。"
  ]);
  assert.deepEqual(result.requirements, [
    "具备良好的工程基础和问题分析能力。"
  ]);
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
  const continuedSection = pages[1].sections.find(
    (section) => section.key === "responsibilities"
  );
  if (continuedSection) {
    const firstPageResponsibilities = pages[0].sections.find(
      (section) => section.key === "responsibilities"
    );
    assert.equal(
      continuedSection.startIndex,
      firstPageResponsibilities.items.length
    );
  }
});

test("中等篇幅 JD 尽量保留在一张卡片", () => {
  const pages = paginateJd({
    company: "测试公司",
    role: "数据平台负责人",
    summary: "负责大型数据平台的架构演进、核心能力建设和跨团队交付。",
    responsibilities: Array.from(
      { length: 7 },
      (_, index) =>
        `负责第 ${index + 1} 项平台能力的方案设计、核心开发、稳定交付和持续优化。`
    ),
    requirements: Array.from(
      { length: 6 },
      (_, index) =>
        `具备第 ${index + 1} 类复杂系统的开发、性能优化和线上问题排查经验。`
    ),
    bonusPoints: ["具有大型平台从零到一建设经验。"]
  });

  assert.equal(pages.length, 1);
  assert.ok(pages[0].weight > 16.5);
});

test("同一栏目跨卡片时序号连续", () => {
  const pages = paginateJd({
    company: "测试公司",
    role: "高级工程师",
    responsibilities: Array.from(
      { length: 12 },
      (_, index) =>
        `负责第 ${index + 1} 个复杂业务模块的架构设计、核心功能开发、性能治理、线上稳定性优化、跨团队交付以及长期技术演进，并持续推进复杂问题定位、容量规划、成本治理和多团队协作机制完善。`
    )
  });

  assert.equal(pages.length, 2);
  const firstSection = pages[0].sections[0];
  const secondSection = pages[1].sections[0];
  assert.equal(secondSection.key, "responsibilities");
  assert.equal(secondSection.startIndex, firstSection.items.length);
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

test("保密模式确定性隐藏公司名称与原文链接", async () => {
  const previous = process.env.MOCK_AI;
  process.env.MOCK_AI = "true";
  try {
    const result = await structureJd({
      rawJd: "测试科技公司招聘后端工程师，官网 https://example.com。",
      mode: "confidential",
      searchOfficialLink: true
    });

    assert.equal(result.libraryCompany, "测试科技公司");
    assert.equal(result.company, "保密公司");
    assert.equal(result.companyUrl, "");
    assert.equal(result.companyUrlConfidence, "none");
  } finally {
    if (previous === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = previous;
  }
});

test("识别百炼的瞬时连接错误", () => {
  const error = new TypeError("fetch failed", {
    cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
  });

  assert.equal(isTransientNetworkError(error), true);
  assert.equal(isTransientNetworkError(new Error("模型参数错误")), false);
});

test("百炼瞬时连接失败后自动重试", async () => {
  const previousMock = process.env.MOCK_AI;
  const previousKey = process.env.DASHSCOPE_API_KEY;
  const previousFetch = globalThis.fetch;
  let attempts = 0;

  process.env.MOCK_AI = "false";
  process.env.DASHSCOPE_API_KEY = "test-key";
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new TypeError("fetch failed", {
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
      });
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                company: "测试科技公司",
                role: "后端工程师",
                locations: ["北京"],
                summary: "负责平台开发。",
                responsibilities: ["负责平台开发。"],
                requirements: ["熟悉 Node.js。"],
                bonusPoints: []
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await structureJd({
      rawJd: "测试科技公司招聘后端工程师，工作地点北京。",
      mode: "faithful"
    });
    assert.equal(attempts, 2);
    assert.equal(result.role, "后端工程师");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMock === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = previousMock;
    if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = previousKey;
  }
});
