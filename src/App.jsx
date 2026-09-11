import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Briefcase,
  CaretLeft,
  CaretRight,
  Check,
  Copy,
  CaretDown,
  DownloadSimple,
  PencilSimple,
  PaperPlaneTilt
} from "@phosphor-icons/react";
import { toPng } from "html-to-image";
import DinoRunner from "./components/DinoRunner.jsx";
import DotMatrixLoader from "./components/DotMatrixLoader.jsx";
import JobEditorDialog from "./components/JobEditorDialog.jsx";
import JobCard from "./components/JobCard.jsx";
import JobLibraryDrawer from "./components/JobLibraryDrawer.jsx";
import {
  MODE_OPTIONS,
  SAMPLE_RAW_JD,
  enforceJdMode,
  formatJdText,
  normalizeStructuredJd,
  paginateJd,
  publicJdData
} from "./lib/jd.js";
import {
  getBrowserJobLibrary,
  sortLibraryJobs
} from "./lib/job-library.js";

const APP_BASE_PATH = String(import.meta.env.VITE_APP_BASE_PATH || "").replace(
  /\/+$/,
  ""
);

const apiPath = (path) => {
  const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "");
  return APP_BASE_PATH
    ? `${APP_BASE_PATH}/api/${normalizedPath}/`
    : `/api/${normalizedPath}`;
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

export default function App() {
  const [rawJd, setRawJd] = useState("");
  const [mode, setMode] = useState("confidential");
  const [searchOfficialLink, setSearchOfficialLink] = useState(false);
  const [data, setData] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState("");
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryAvailable, setLibraryAvailable] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [notice, setNotice] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const batchCancelRef = useRef(false);
  const [revisionHistory, setRevisionHistory] = useState([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const library = useMemo(() => getBrowserJobLibrary(), []);
  const progressTimer = useRef(null);
  const copyTimer = useRef(null);
  const noticeTimer = useRef(null);
  const noticeAction = useRef(null);
  const operationInFlight = useRef(false);
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
  const busy =
    status === "checking" || status === "generating" || status === "revising" || Boolean(batchProgress);
  const processLabel =
    status === "revising"
      ? "正在修改卡片"
      : progress < 36
        ? "正在识别信息"
        : progress < 72
          ? "正在整理结构"
          : "正在生成卡片";

  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingRecordId(null);
  }, []);
  const invalidateCurrentCard = useCallback(() => {
    setData(null);
    setActiveRecordId(null);
    setPageIndex(0);
    setRevision("");
    setRevisionHistory([]);
    setStatus("idle");
    setProgress(0);
    setError("");
  }, []);

  useEffect(() => {
    if (pageIndex >= pages.length) setPageIndex(Math.max(0, pages.length - 1));
  }, [pageIndex, pages.length]);

  useEffect(
    () => () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
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

  const showNotice = useCallback(
    (message, { actionLabel = "", action = null, duration = 4200 } = {}) => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeAction.current = action;
      setNotice({ message, actionLabel });
      noticeTimer.current = setTimeout(() => {
        setNotice(null);
        noticeAction.current = null;
        noticeTimer.current = null;
      }, duration);
    },
    []
  );

  const refreshLibrary = useCallback(async () => {
    const items = await library.list();
    setLibraryItems(items);
    return items;
  }, [library]);

  const upsertLibraryItem = useCallback((record) => {
    if (!record) return;
    setLibraryItems((current) =>
      sortLibraryJobs([record, ...current.filter((item) => item.id !== record.id)])
    );
  }, []);

  const openLibrary = useCallback(() => {
    setLibraryOpen(true);
    refreshLibrary().catch(() => {
      showNotice("岗位库列表暂时无法刷新");
    });
  }, [refreshLibrary, showNotice]);

  useEffect(() => {
    let cancelled = false;
    library
      .migrateLegacy()
      .then((items) => {
        if (!cancelled) setLibraryItems(items);
      })
      .catch(() => {
        if (!cancelled) {
          setLibraryAvailable(false);
          showNotice("当前浏览器无法启用岗位库，仍可正常生成卡片");
        }
      })
      .finally(() => {
        if (!cancelled) setLibraryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [library, showNotice]);

  const activateLibraryRecord = useCallback((item) => {
    const recordMode = item.mode || "confidential";
    setRawJd(item.rawJd || "");
    setMode(recordMode);
    setSearchOfficialLink(
      recordMode !== "confidential" && Boolean(item.searchOfficialLink)
    );
    setData(enforceJdMode(item.data, recordMode));
    setActiveRecordId(item.id);
    setPageIndex(0);
    setRevisionHistory([]);
    setStatus("ready");
    setProgress(0);
    setError("");
  }, []);

  const saveGeneratedRecord = useCallback(
    async (nextData, input) => {
      if (!libraryAvailable) return null;
      try {
        const record = await library.saveGenerated({ ...input, data: nextData });
        setActiveRecordId(record.id);
        upsertLibraryItem(record);
        return record;
      } catch {
        setLibraryAvailable(false);
        showNotice("卡片已生成，但当前浏览器无法保存岗位库");
        return null;
      }
    },
    [library, libraryAvailable, showNotice, upsertLibraryItem]
  );

  const generateBatch = async (parts) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    batchCancelRef.current = false;
    setBatchProgress({ current: 0, total: parts.length, success: 0, failed: 0 });
    setError("");
    let success = 0, failed = 0, lastData = null;
    for (let i = 0; i < parts.length; i += 1) {
      if (batchCancelRef.current) break;
      const input = { rawJd: parts[i].trim(), mode, searchOfficialLink: effectiveSearchOfficialLink };
      setBatchProgress({ current: i + 1, total: parts.length, success, failed });
      try {
        const nextData = enforceJdMode(await postJson(apiPath("structure-jd"), input), mode);
        await saveGeneratedRecord(nextData, input);
        success += 1; lastData = nextData;
      } catch { failed += 1; }
      setBatchProgress({ current: i + 1, total: parts.length, success, failed });
    }
    if (lastData) { setData(lastData); setPageIndex(0); setStatus("ready"); }
    setBatchProgress(null); operationInFlight.current = false;
    showNotice(`批量生成完成：成功 ${success} 份，失败 ${failed} 份${batchCancelRef.current ? "（已取消）" : ""}`);
  };

  const generate = async ({ skipCache = false } = {}) => {
    if (operationInFlight.current) return;
    const batchParts = rawJd.split(/^[ \t]*---[ \t]*$/m).map((part) => part.trim()).filter(Boolean);
    if (batchParts.length > 1 && !skipCache) { generateBatch(batchParts); return; }
    const input = {
      rawJd: rawJd.trim(),
      mode,
      searchOfficialLink: effectiveSearchOfficialLink
    };
    if (input.rawJd.length < 10) {
      setError("请先粘贴一段完整的岗位信息");
      return;
    }

    operationInFlight.current = true;
    setError("");
    setStatus("checking");

    if (!skipCache && libraryReady && libraryAvailable) {
      try {
        const cached = await library.findExact(input);
        if (cached) {
          const touched = (await library.touch(cached.id)) || cached;
          activateLibraryRecord(touched);
          upsertLibraryItem(touched);
          showNotice("已从岗位库取回，没有重复调用 AI", {
            actionLabel: "重新生成",
            action: () => generate({ skipCache: true }),
            duration: 5600
          });
          operationInFlight.current = false;
          return;
        }
      } catch {
        setLibraryAvailable(false);
      }
    }

    setStatus("generating");
    startProgress();
    try {
      const nextData = enforceJdMode(
        await postJson(apiPath("structure-jd"), input),
        input.mode
      );
      finishProgress();
      setData(nextData);
      setRevisionHistory([]);
      setPageIndex(0);
      const savedRecord = await saveGeneratedRecord(nextData, input);
      if (savedRecord) showNotice("已保存到岗位库");
      setTimeout(() => setStatus("ready"), 260);
    } catch (requestError) {
      finishProgress();
      setStatus("idle");
      setError(
        requestError.code === "missing_api_key"
          ? "尚未配置百炼 API Key，请先填写项目根目录下的 .env"
          : requestError.message
      );
    } finally {
      operationInFlight.current = false;
    }
  };

  const undoRevision = async () => {
    if (!revisionHistory.length || !normalizedData) return;
    const previous = revisionHistory[revisionHistory.length - 1];
    setRevisionHistory((history) => history.slice(0, -1));
    setData(previous);
    setPageIndex(0);
    if (activeRecordId && libraryAvailable) {
      try {
        const record = await library.update(activeRecordId, { data: previous });
        upsertLibraryItem(record);
      } catch {}
    }
    showNotice("已撤销到上一版");
  };

  const revise = async () => {
    if (
      !normalizedData ||
      !revision.trim() ||
      operationInFlight.current
    )
      return;
    operationInFlight.current = true;
    setError("");
    setStatus("revising");
    startProgress();
    try {
      const revisedData = normalizeStructuredJd(
        await postJson(apiPath("revise-jd"), {
          current: publicJdData(normalizedData),
          instruction: revision,
          mode
        })
      );
      const nextData = enforceJdMode(
        {
          ...revisedData,
          libraryCompany: normalizedData.libraryCompany,
          libraryRole: normalizedData.libraryRole
        },
        mode
      );
      finishProgress();
      setData(nextData);
      setRevisionHistory((history) => [...history, normalizedData].slice(-20));
      setPageIndex(0);
      setRevision("");
      if (libraryAvailable) {
        try {
          const record = activeRecordId
            ? await library.update(activeRecordId, { data: nextData })
            : await library.saveGenerated({
                rawJd,
                mode,
                searchOfficialLink: effectiveSearchOfficialLink,
                data: nextData
              });
          setActiveRecordId(record.id);
          upsertLibraryItem(record);
          showNotice("修改已保存到岗位库");
        } catch {
          setLibraryAvailable(false);
          showNotice("卡片已修改，但当前浏览器无法保存岗位库");
        }
      }
      setTimeout(() => setStatus("ready"), 260);
    } catch (requestError) {
      finishProgress();
      setStatus("ready");
      setError(requestError.message);
    } finally {
      operationInFlight.current = false;
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

  const downloadCurrent = async () => {
    if (!pages.length || downloading) return;
    setDownloading(true); setError("");
    try {
      const url = await renderCardImage(exportCardRefs.current.get(pageIndex));
      saveDownload(url, `${safeFilename(normalizedData.role)}-${pageIndex + 1}.png`);
    } catch { setError("当前卡片生成失败，请重试"); }
    finally { setDownloading(false); }
  };

  const downloadPdf = () => {
    if (!normalizedData) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>${safeFilename(normalizedData.role)}</title><style>body{margin:0} .page{page-break-after:always} img{width:100%;display:block}</style></head><body>`);
    Promise.all(pages.map((_, i) => renderCardImage(exportCardRefs.current.get(i)))).then((urls) => {
      printWindow.document.body.innerHTML = urls.map((u) => `<div class="page"><img src="${u}"/></div>`).join("");
      printWindow.document.close(); printWindow.focus(); printWindow.print();
    });
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

  const loadLibraryItem = async (item) => {
    activateLibraryRecord(item);
    setLibraryOpen(false);
    try {
      const touched = await library.touch(item.id);
      upsertLibraryItem(touched);
    } catch {
      showNotice("岗位已打开，但最近访问时间未能保存");
    }
  };

  const editLibraryItem = (item) => {
    activateLibraryRecord(item);
    setEditingRecordId(item.id);
    setLibraryOpen(false);
    setEditorOpen(true);
  };

  const openCurrentEditor = () => {
    if (!normalizedData) return;
    setEditingRecordId(activeRecordId);
    setEditorOpen(true);
  };

  const saveDirectEdit = async (nextData) => {
    const safeNextData = enforceJdMode(nextData, mode);
    setSavingEdit(true);
    setData(safeNextData);
    setPageIndex(0);
    try {
      if (!libraryAvailable) throw new Error("storage_unavailable");
      const record = editingRecordId
        ? await library.update(editingRecordId, { data: safeNextData })
        : await library.saveGenerated({
            rawJd,
            mode,
            searchOfficialLink: effectiveSearchOfficialLink,
            data: safeNextData
          });
      setActiveRecordId(record.id);
      upsertLibraryItem(record);
      setEditorOpen(false);
      setEditingRecordId(null);
      showNotice("修改已保存，不需要重新调用 AI");
    } catch {
      setEditorOpen(false);
      setEditingRecordId(null);
      showNotice("当前卡片已修改，但岗位库未能保存");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteLibraryItem = async (item) => {
    try {
      const removed = await library.remove(item.id);
      setLibraryItems((current) => current.filter((record) => record.id !== item.id));
      if (activeRecordId === item.id) {
        setData(null);
        setRawJd("");
        setActiveRecordId(null);
        setStatus("idle");
        setPageIndex(0);
      }
      if (removed) {
        showNotice("已从岗位库删除", {
          actionLabel: "撤销",
          action: async () => {
            try {
              await library.put(removed);
              upsertLibraryItem(removed);
              showNotice("已恢复到岗位库");
            } catch {
              setError("恢复失败，请重新生成该岗位");
            }
          },
          duration: 15000
        });
      }
    } catch {
      setError("删除失败，请重试");
    }
  };

  const reset = () => {
    setRawJd("");
    setMode("confidential");
    setSearchOfficialLink(false);
    setData(null);
    setActiveRecordId(null);
    setEditingRecordId(null);
    setEditorOpen(false);
    setRevision("");
    setStatus("idle");
    setProgress(0);
    setError("");
    setPageIndex(0);
  };

  return (
    <div className="app-frame">
      <main
        className="workspace"
        inert={libraryOpen || editorOpen ? true : undefined}
      >
        <section className="editor-panel" aria-labelledby="editor-title">
          <div className="panel-heading">
            <div>
              <h1 id="editor-title">粘贴岗位 JD</h1>
            </div>
            <div className="panel-utilities">
              {data ? (
                <button
                  type="button"
                  className="text-button new-button"
                  onClick={reset}
                  disabled={busy}
                >
                  <ArrowCounterClockwise size={16} />
                  新建
                </button>
              ) : null}
              <button
                type="button"
                className="text-button library-button"
                onClick={openLibrary}
                disabled={busy}
              >
                <Briefcase size={17} />
                岗位库
                {libraryItems.length ? <span className="library-count">{libraryItems.length}</span> : null}
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
                invalidateCurrentCard();
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
              onChange={(event) => {
                setRawJd(event.target.value);
                invalidateCurrentCard();
              }}
              placeholder="可以很乱，直接粘贴即可。支持公司介绍、岗位职责、任职要求、Base 和相关链接。多份岗位请用单独一行 --- 分隔。"
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
                      invalidateCurrentCard();
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
                  onChange={(event) => {
                    setSearchOfficialLink(event.target.checked);
                    invalidateCurrentCard();
                  }}
                />
                <span>
                  <strong>联网搜索官网或相关链接</strong>
                  <small>仅在结果置信度高时添加二维码</small>
                </span>
              </label>
            ) : null}
          </fieldset>

          {batchProgress ? <p className="batch-progress">第 {batchProgress.current}/{batchProgress.total} 份 · 成功 {batchProgress.success} · 失败 {batchProgress.failed} <button type="button" className="text-button" onClick={() => { batchCancelRef.current = true; }}>取消</button></p> : null}

          <div className={`generate-zone${generating ? " is-playing" : ""}`}>
            <DinoRunner active={generating} />
            <button
              type="button"
              className={`primary-action${generating || status === "checking" ? " is-processing" : ""}`}
              onClick={() => generate()}
              disabled={busy || rawJd.trim().length < 10}
              aria-label={
                generating
                  ? `${processLabel}，${Math.round(progress)}%`
                  : status === "checking"
                    ? "正在查询岗位库"
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
                ) : status === "checking" ? (
                  <>正在查询岗位库</>
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
            <div className="revision-controls">
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
              {revisionHistory.length ? <button className="undo-action" type="button" onClick={undoRevision} disabled={busy} title="撤销上一版">撤销 ({revisionHistory.length})</button> : null}
            </div>
            <div className="download-actions">
              <button
                type="button"
                className="secondary-icon-action"
                onClick={openCurrentEditor}
                disabled={!normalizedData || busy}
                aria-label="直接修改卡片内容"
                title="直接修改卡片内容"
              >
                <PencilSimple size={20} />
              </button>
              <button
                type="button"
                onClick={downloadAll}
                disabled={!normalizedData || downloading}
                aria-label={downloading ? "正在生成全部图片" : "下载全部图片"}
                title={downloading ? "正在生成全部图片" : "全部（PNG）"}
              >
                {downloading ? (
                  <span className="mini-loader" aria-hidden="true" />
                ) : (
                  <DownloadSimple size={20} weight="bold" />
                )}
              </button>
              <div className="export-menu-wrap">
                <button type="button" className="export-menu-trigger" onClick={() => setExportMenuOpen((open) => !open)} disabled={!normalizedData || downloading} aria-label="更多下载选项" aria-expanded={exportMenuOpen}>
                  <CaretDown size={16} weight="bold" />
                </button>
                {exportMenuOpen ? <div className="export-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { downloadCurrent(); setExportMenuOpen(false); }} disabled={downloading}>下载当前页</button>
                  <button type="button" role="menuitem" onClick={() => { downloadPdf(); setExportMenuOpen(false); }} disabled={downloading}>下载 PDF</button>
                </div> : null}
              </div>
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

      <JobLibraryDrawer
        open={libraryOpen}
        items={libraryItems}
        onClose={closeLibrary}
        onSelect={loadLibraryItem}
        onEdit={editLibraryItem}
        onDelete={deleteLibraryItem}
        onImported={async (result) => {
          if (result?.error) { showNotice("导入失败，请检查 JSON 文件"); return; }
          await refreshLibrary();
          showNotice(`导入完成：写入 ${result.imported} 个，跳过 ${result.skipped} 个`);
        }}
      />

      <JobEditorDialog
        open={editorOpen}
        data={normalizedData}
        mode={mode}
        saving={savingEdit}
        onClose={closeEditor}
        onSave={saveDirectEdit}
      />

      {notice ? (
        <div className="app-notice" role="status">
          <span>{notice.message}</span>
          {notice.actionLabel ? (
            <button
              type="button"
              onClick={() => {
                const action = noticeAction.current;
                if (noticeTimer.current) clearTimeout(noticeTimer.current);
                noticeTimer.current = null;
                noticeAction.current = null;
                setNotice(null);
                action?.();
              }}
            >
              {notice.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
