export const MODE_OPTIONS = [
  {
    id: "faithful",
    label: "原文整理",
    description: "只清洗、归类和去重，不改变原意"
  },
  {
    id: "polished",
    label: "适度润色",
    description: "适合只有岗位基本信息或内容较少的 JD，补充通用职责与要求"
  },
  {
    id: "confidential",
    label: "保密泛化",
    description: "隐藏敏感名称，并泛化容易识别的具体描述"
  }
];

export const SAMPLE_RAW_JD = `某 AI 基础设施创业公司招聘高级后端工程师，Base 北京或上海。

主要负责模型服务平台、推理任务调度和内部研发工具；需要和算法、产品团队一起推进项目落地。希望候选人熟悉 Python 或 Go，做过分布式系统、微服务和云原生，有较强的问题定位能力。熟悉 Kubernetes、消息队列、模型推理服务优先。

公司团队来自头部科技公司和高校实验室，专注企业级 AI 基础设施产品。官网：https://example.com`;

const cleanText = (value = "") =>
  String(value)
    .replace(/\*\*|__|```(?:json)?|```/gi, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const textValue = (value) => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return cleanText(value.join("、"));
  return cleanText(value);
};

const listValue = (value) => {
  if (!value) return [];
  const items = Array.isArray(value)
    ? value
    : String(value).split(/\n|；|;|(?=\d+[.、])/);
  return items
    .map((item) => textValue(item).replace(/^\d+[.、]\s*/, ""))
    .filter(Boolean)
    .slice(0, 12);
};

export function normalizeStructuredJd(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const companyUrl = textValue(source.companyUrl || source.website || source.url);
  return {
    company: textValue(source.company || source.companyName),
    role: textValue(source.role || source.jobTitle || source.position),
    locations: listValue(source.locations || source.location || source.base),
    summary: textValue(source.summary || source.roleSummary),
    responsibilities: listValue(source.responsibilities || source.duties),
    requirements: listValue(source.requirements || source.qualifications),
    bonusPoints: listValue(source.bonusPoints || source.preferred || source.bonuses),
    companyIntroduction: textValue(
      source.companyIntroduction || source.companyIntro || source.aboutCompany
    ),
    companyUrl,
    companyUrlConfidence: companyUrl
      ? textValue(source.companyUrlConfidence || "high").toLowerCase()
      : "none",
    companyUrlSource: companyUrl
      ? textValue(source.companyUrlSource || "provided").toLowerCase()
      : "none",
    companyUrlType: companyUrl
      ? textValue(source.companyUrlType || "official").toLowerCase()
      : "none",
    uncertainFields: listValue(source.uncertainFields),
    warnings: listValue(source.warnings)
  };
}

const lineWeight = (text) => {
  const length = String(text || "").length;
  return Math.max(1, Math.ceil(length / 38));
};

export function paginateJd(data) {
  const normalized = normalizeStructuredJd(data);
  const groups = [
    normalized.summary
      ? { key: "summary", title: "岗位概览", items: [normalized.summary] }
      : null,
    normalized.responsibilities.length
      ? {
          key: "responsibilities",
          title: "岗位职责",
          items: normalized.responsibilities
        }
      : null,
    normalized.requirements.length
      ? { key: "requirements", title: "任职要求", items: normalized.requirements }
      : null,
    normalized.bonusPoints.length
      ? { key: "bonusPoints", title: "加分项", items: normalized.bonusPoints }
      : null
  ].filter(Boolean);

  const pages = [];
  let page = { sections: [], weight: 0 };
  const singlePageBudget = 23.5;

  const pushPage = () => {
    if (!page.sections.length) return;
    pages.push(page);
    page = { sections: [], weight: 0 };
  };

  for (const group of groups) {
    for (const [itemIndex, item] of group.items.entries()) {
      const existing = page.sections.find((section) => section.key === group.key);
      const headerCost = existing ? 0 : 0.85;
      const itemCost = 0.4 + lineWeight(item) * 0.56;

      if (
        pages.length === 0 &&
        page.sections.length &&
        page.weight + headerCost + itemCost > singlePageBudget
      ) {
        pushPage();
      }

      let section = page.sections.find((entry) => entry.key === group.key);
      if (!section) {
        section = {
          key: group.key,
          title: group.title,
          items: [],
          startIndex: itemIndex
        };
        page.sections.push(section);
        page.weight += 0.85;
      }
      section.items.push(item);
      page.weight += itemCost;
    }
  }

  pushPage();
  return pages.length ? pages : [{ sections: [], weight: 0 }];
}

export function isMeaningfulJd(data) {
  const normalized = normalizeStructuredJd(data);
  return Boolean(
    normalized.role ||
      normalized.company ||
      normalized.responsibilities.length ||
      normalized.requirements.length
  );
}

const numberedLines = (items) =>
  items.length
    ? items.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "未提供";

export function formatJdText(input = {}) {
  const data = normalizeStructuredJd(input);
  const blocks = [
    `公司：${data.company || "未公开"}`,
    data.companyUrl && data.companyUrlConfidence === "high"
      ? `公司官网或相关链接：${data.companyUrl}`
      : null,
    `岗位：${data.role || "待确认"}`,
    `Base：${data.locations.length ? data.locations.join("、") : "未提供"}`,
    `岗位概述：\n${data.summary || "未提供"}`,
    `岗位职责：\n${numberedLines(data.responsibilities)}`,
    `岗位要求：\n${numberedLines(data.requirements)}`,
    data.bonusPoints.length
      ? `加分项：\n${numberedLines(data.bonusPoints)}`
      : null
  ];

  return blocks.filter(Boolean).join("\n\n");
}
