import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Copy,
  DownloadSimple,
  PaperPlaneTilt,
  X
} from "@phosphor-icons/react";
import { toPng } from "html-to-image";
import DinoRunner from "./components/DinoRunner.jsx";
import DotMatrixLoader from "./components/DotMatrixLoader.jsx";
import JobCard from "./components/JobCard.jsx";
import {
  MODE_OPTIONS,
  SAMPLE_RAW_JD,
  formatJdText,
  normalizeStructuredJd,
  paginateJd
} from "./lib/jd.js";

const HISTORY_KEY = "zhi-dao-le:history:v1";
const MAX_HISTORY = 10;

const safeHistory = () => {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
};

const safeFilename = (value) =>
  String(value || "岗位卡片")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 50);

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败，请稍后重试");
    error.code = payload.code;
    throw error;
  }
  return payload.data;
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy_failed");
}

function EmptyPreview() {
  return (
    <div className="empty-preview" aria-label="空卡片预览">
      <div className="empty-preview__sheet">
        <div className="empty-preview__topline" />
        <div className="empty-preview__title" />
        <div className="empty-preview__subtitle" />
        <div className="empty-preview__rule" />
        <div className="empty-preview__rows">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function HistoryDrawer({ open, items, onClose, onSelect, onClear }) {
  if (!open) return null;
  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="history-drawer"
        aria-label="历史记录"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>历史记录</h2>
            <p>仅保存在当前浏览器</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} weight="bold" />
          </button>
        </header>

        {items.length ? (
          <div className="history-list">
            {items.map((item) => (
              <button key={item.id} type="button" onClick={() => onSelect(item)}>
                <strong>{item.data?.role || "未命名岗位"}</strong>
                <span>{item.data?.company || "公司待确认"}</span>
                <time>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
              </button>
            ))}
          </div>
        ) : (
          <div className="history-empty">
            <ClockCounterClockwise size={28} />
            <p>还没有生成记录</p>
          </div>
        )}

        {items.length ? (
          <button type="button" className="clear-history" onClick={onClear}>
            清空历史记录
          </button>
        ) : null}
      </aside>
    </div>
  );
}

export default function App() {
  const [rawJd, setRawJd] = useState("");
  const [mode, setMode] = useState("faithful");
  const [searchOfficialLink, setSearchOfficialLink] = useState(false);
  const [data, setData] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState("");
  const [history, setHistory] = useState(safeHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const progressTimer = useRef(null);
  const copyTimer = useRef(null);
  const exportCardRefs = useRef(new Map());

  const normalizedData = useMemo(
    () => (data ? normalizeStructuredJd(data) : null),
    [data]
  );
  const pages = useMemo(
    () => (normalizedData ? paginateJd(normalizedData) : []),
    [normalizedData]
  );
  const selectedMode = MODE_OPTIONS.find((option) => option.id === mode);
  const canSearchOfficialLink = mode !== "confidential";
  const effectiveSearchOfficialLink = canSearchOfficialLink && searchOfficialLink;
  const generating = status === "generating";
  const busy = status === "generating" || status === "revising";
  const processLabel =
    status === "revising"
      ? "正在修改卡片"
      : progress < 36
        ? "正在识别信息"
        : progress < 72
          ? "正在整理结构"
          : "正在生成卡片";

  useEffect(() => {
    if (pageIndex >= pages.length) setPageIndex(Math.max(0, pages.length - 1));
  }, [pageIndex, pages.length]);

  useEffect(
    () => () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  useEffect(() => {
    setCopied(false);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = null;
  }, [data]);

  const startProgress = useCallback(() => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    setProgress(8);
    progressTimer.current = setInterval(() => {
      setProgress((value) => Math.min(92, value + Math.max(2, (94 - value) * 0.08)));
    }, 420);
  }, []);

  const finishProgress = useCallback(() => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = null;
    setProgress(100);
  }, []);

  const persistHistory = useCallback(
    (nextData) => {
      const item = {
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        rawJd,
        mode,
        searchOfficialLink: effectiveSearchOfficialLink,
        data: nextData
      };
      setHistory((current) => {
        const next = [item, ...current].slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    },
    [effectiveSearchOfficialLink, mode, rawJd]
  );

  const generate = async () => {
    if (busy) return;
    if (rawJd.trim().length < 10) {
      setError("请先粘贴一段完整的岗位信息");
      return;
    }

    setError("");
    setStatus("generating");
    startProgress();
    try {
      const nextData = normalizeStructuredJd(
        await postJson("/api/structure-jd", {
          rawJd,
          mode,
          searchOfficialLink: effectiveSearchOfficialLink
        })
      );
      finishProgress();
      setData(nextData);
      setPageIndex(0);
      persistHistory(nextData);
      setTimeout(() => setStatus("ready"), 260);
    } catch (requestError) {
      finishProgress();
      setStatus("idle");
      setError(
        requestError.code === "missing_api_key"
          ? "尚未配置百炼 API Key，请先填写项目根目录下的 .env"
          : requestError.message
      );
    }
  };

  const revise = async () => {
    if (!normalizedData || !revision.trim() || busy) return;
    setError("");
    setStatus("revising");
    startProgress();
    try {
      const nextData = normalizeStructuredJd(
        await postJson("/api/revise-jd", {
          current: normalizedData,
          instruction: revision,
          mode
        })
      );
      finishProgress();
      setData(nextData);
      setPageIndex(0);
      setRevision("");
      persistHistory(nextData);
      setTimeout(() => setStatus("ready"), 260);
    } catch (requestError) {
      finishProgress();
      setStatus("ready");
      setError(requestError.message);
    }
  };

  const renderCardImage = async (node) => {
    if (!node || !normalizedData) throw new Error("missing_card");
    await document.fonts?.ready;
    const { width, height } = node.getBoundingClientRect();
    if (!width || !height) throw new Error("invalid_card_size");

    return toPng(node, {
      cacheBust: true,
      pixelRatio: 1080 / width,
      width,
      height
    });
  };

  const saveDownload = (url, filename, revoke = false) => {
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadAll = async () => {
    if (!pages.length || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const baseName = safeFilename(normalizedData.role);
      if (pages.length === 1) {
        const url = await renderCardImage(exportCardRefs.current.get(0));
        saveDownload(url, `${baseName}.png`);
        return;
      }

      const renderedCards = [];
      for (let index = 0; index < pages.length; index += 1) {
        const url = await renderCardImage(exportCardRefs.current.get(index));
        renderedCards.push({
          url,
          filename: `${baseName}-${index + 1}.png`
        });
      }

      renderedCards.forEach(({ url, filename }) => saveDownload(url, filename));
    } catch {
      setError("全部卡片生成失败，请重试");
    } finally {
      setDownloading(false);
    }
  };

  const copyTextExport = async () => {
    if (!normalizedData) return;
    setError("");
    try {
      await writeClipboard(formatJdText(normalizedData));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopied(false);
        copyTimer.current = null;
      }, 1800);
    } catch {
      setError("文字复制失败，请重试");
    }
  };

  const loadHistory = (item) => {
    const historyMode = item.mode || "faithful";
    setRawJd(item.rawJd || "");
    setMode(historyMode);
    setSearchOfficialLink(
      historyMode !== "confidential" && Boolean(item.searchOfficialLink)
    );
    setData(normalizeStructuredJd(item.data));
    setPageIndex(0);
    setStatus("ready");
    setError("");
    setHistoryOpen(false);
  };

  const reset = () => {
    setRawJd("");
    setData(null);
    setRevision("");
    setStatus("idle");
    setProgress(0);
    setError("");
    setPageIndex(0);
  };

  return (
    <div className="app-frame">
      <main className="workspace">
        <section className="editor-panel" aria-labelledby="editor-title">
          <div className="panel-heading">
            <div>
              <h1 id="editor-title">粘贴岗位 JD</h1>
            </div>
            <div className="panel-utilities">
              {data ? (
                <button type="button" className="text-button" onClick={reset}>
                  <ArrowCounterClockwise size={16} />
                  新建
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={() => setHistoryOpen(true)}>
                <ClockCounterClockwise size={17} />
                历史记录
                {history.length ? <span className="history-count">{history.length}</span> : null}
              </button>
            </div>
          </div>

          <div className="field-label-row">
            <label className="field-label" htmlFor="raw-jd">
              公司及岗位信息
            </label>
            <button
              type="button"
              className="sample-button"
              onClick={() => {
                setRawJd(SAMPLE_RAW_JD);
                setError("");
              }}
              disabled={busy}
            >
              填入示例
            </button>
          </div>
          <div className="textarea-wrap">
            <textarea
              id="raw-jd"
              value={rawJd}
              onChange={(event) => setRawJd(event.target.value)}
              placeholder="可以很乱，直接粘贴即可。支持公司介绍、岗位职责、任职要求、Base 和相关链接。"
              maxLength={30000}
              disabled={busy}
            />
            <span>{rawJd.length.toLocaleString("zh-CN")} / 30,000</span>
          </div>

          <fieldset className="mode-fieldset" disabled={busy}>
            <legend>整理方式</legend>
            <div className="mode-options">
              {MODE_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={`mode-option${mode === option.id ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={option.id}
                    checked={mode === option.id}
                    onChange={() => {
                      setMode(option.id);
                      if (option.id === "confidential") setSearchOfficialLink(false);
                    }}
                  />
                  <span className="mode-option__dot" aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="mode-description">{selectedMode?.description}</p>
            {canSearchOfficialLink ? (
              <label className="web-search-option">
                <input
                  type="checkbox"
                  checked={searchOfficialLink}
                  onChange={(event) => setSearchOfficialLink(event.target.checked)}
                />
                <span>
                  <strong>联网搜索官网或相关链接</strong>
                  <small>仅在结果置信度高时添加二维码</small>
                </span>
              </label>
            ) : null}
          </fieldset>

          <div className={`generate-zone${generating ? " is-playing" : ""}`}>
            <DinoRunner active={generating} />
            <button
              type="button"
              className={`primary-action${generating ? " is-processing" : ""}`}
              onClick={generate}
              disabled={busy || rawJd.trim().length < 10}
              aria-label={
                generating
                  ? `${processLabel}，${Math.round(progress)}%`
                  : "整理并生成卡片"
              }
            >
              <span
                className="primary-action__progress"
                style={{ transform: `scaleX(${generating ? progress / 100 : 0})` }}
              />
              <span className="primary-action__label">
                {generating ? (
                  <>
                    <DotMatrixLoader size={20} className="primary-action__loader" />
                    <span className="primary-action__percent" aria-hidden="true">
                      <span className="primary-action__percent-number">
                        {Math.round(progress)}
                      </span>
                      <span className="primary-action__percent-sign">%</span>
                    </span>
                    <span className="sr-only">{processLabel}</span>
                  </>
                ) : (
                  <>整理并生成卡片</>
                )}
              </span>
            </button>
          </div>

          {error ? <p className="inline-error" role="alert">{error}</p> : null}

          <p className="privacy-note">
            AI 只整理你提供的内容，不应补写原文不存在的事实。生成后请人工确认。
          </p>
        </section>

        <section className="preview-panel" aria-label="卡片预览">
          <div className="preview-canvas">
            {pages.length > 1 ? (
              <div className="page-switcher" aria-label="卡片翻页">
                <button
                  type="button"
                  onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
                  disabled={pageIndex === 0}
                  aria-label="上一张"
                >
                  <CaretLeft size={16} weight="bold" />
                </button>
                <span>{pageIndex + 1} / {pages.length}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPageIndex((value) => Math.min(pages.length - 1, value + 1))
                  }
                  disabled={pageIndex === pages.length - 1}
                  aria-label="下一张"
                >
                  <CaretRight size={16} weight="bold" />
                </button>
              </div>
            ) : null}
            {normalizedData && pages.length ? (
              <div>
                <JobCard
                  data={normalizedData}
                  page={pages[pageIndex]}
                  pageIndex={pageIndex}
                  pageCount={pages.length}
                />
              </div>
            ) : (
              <EmptyPreview />
            )}
          </div>

          <div className={`preview-actions${normalizedData ? " is-visible" : ""}`}>
            <div className="revision-box">
              <textarea
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    revise();
                  }
                }}
                placeholder="告诉职到了如何修改"
                rows={1}
                disabled={!normalizedData || busy}
              />
              <button
                type="button"
                onClick={revise}
                disabled={!normalizedData || !revision.trim() || busy}
                aria-label="提交修改"
              >
                {status === "revising" ? (
                  <span className="mini-loader" aria-hidden="true" />
                ) : (
                  <PaperPlaneTilt size={18} weight="fill" />
                )}
              </button>
            </div>
            <div className="download-actions">
              <button
                type="button"
                onClick={downloadAll}
                disabled={!normalizedData || downloading}
                aria-label={downloading ? "正在生成全部图片" : "下载全部图片"}
                title={downloading ? "正在生成全部图片" : "下载全部图片"}
              >
                {downloading ? (
                  <span className="mini-loader" aria-hidden="true" />
                ) : (
                  <DownloadSimple size={20} weight="bold" />
                )}
              </button>
              <button
                type="button"
                className={`copy-action${copied ? " is-copied" : ""}`}
                onClick={copyTextExport}
                disabled={!normalizedData}
                aria-label={copied ? "文字已复制" : "复制岗位文字"}
                title={copied ? "文字已复制" : "复制岗位文字"}
              >
                {copied ? (
                  <Check size={20} weight="bold" />
                ) : (
                  <Copy size={20} weight="bold" />
                )}
              </button>
            </div>
          </div>
        </section>
      </main>

      {normalizedData ? (
        <div className="export-stage" aria-hidden="true">
          {pages.map((page, index) => (
            <div
              key={`export-${index}`}
              ref={(node) => {
                if (node) exportCardRefs.current.set(index, node);
                else exportCardRefs.current.delete(index);
              }}
            >
              <JobCard
                data={normalizedData}
                page={page}
                pageIndex={index}
                pageCount={pages.length}
              />
            </div>
          ))}
        </div>
      ) : null}

      <HistoryDrawer
        open={historyOpen}
        items={history}
        onClose={() => setHistoryOpen(false)}
        onSelect={loadHistory}
        onClear={() => {
          localStorage.removeItem(HISTORY_KEY);
          setHistory([]);
        }}
      />
    </div>
  );
}
