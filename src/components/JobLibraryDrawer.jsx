import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  MagnifyingGlass,
  PencilSimple,
  Trash,
  X
} from "@phosphor-icons/react";
import {
  groupLibraryJobs,
  searchLibraryJobs,
  serializeJobLibrary,
  parseJobLibraryExport,
  mergeJobLibraryRecords,
  getBrowserJobLibrary
} from "../lib/job-library.js";

const MODE_LABELS = {
  faithful: "原文整理",
  polished: "适度润色",
  confidential: "保密泛化"
};
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
};

export default function JobLibraryDrawer({
  open,
  items,
  onClose,
  onSelect,
  onEdit,
  onDelete
  ,onImported
}) {
  const fileRef = useRef(null);
  const exportJobs = () => {
    const blob = new Blob([serializeJobLibrary(items)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `zhi-dao-le-job-library-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importJobs = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const records = parseJobLibraryExport(await file.text()); const result = await mergeJobLibraryRecords(getBrowserJobLibrary(), records); onImported?.(result); }
    catch { onImported?.({ error: true }); }
    event.target.value = "";
  };
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const drawerRef = useRef(null);
  const filteredItems = useMemo(
    () => searchLibraryJobs(items, query),
    [items, query]
  );
  const groups = useMemo(
    () => groupLibraryJobs(filteredItems),
    [filteredItems]
  );

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const timer = setTimeout(() => searchRef.current?.focus(), 80);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <aside
        ref={drawerRef}
        className="job-library-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-library-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="job-library-drawer__header">
          <div>
            <h2 id="job-library-title">岗位库</h2>
            <p>{items.length} 个岗位，仅保存在当前浏览器</p>
            <div className="library-transfer">
              <button type="button" onClick={exportJobs}>导出 JSON</button>
              <button type="button" onClick={() => fileRef.current?.click()}>导入 JSON</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJobs} />
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="library-search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索公司、岗位、Base 或关键词"
            aria-label="搜索岗位库"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="清除搜索">
              <X size={14} weight="bold" />
            </button>
          ) : null}
        </div>

        <div className="library-results">
          {!items.length ? (
            <div className="library-empty">
              <Briefcase size={30} />
              <strong>还没有保存岗位</strong>
              <p>生成后的 JD 会自动出现在这里</p>
            </div>
          ) : !filteredItems.length ? (
            <div className="library-empty">
              <MagnifyingGlass size={28} />
              <strong>没有找到相关岗位</strong>
              <p>可以换一个公司、岗位或技能词</p>
            </div>
          ) : (
            groups.map((group) => (
              <section className="library-company" key={group.company}>
                <header>
                  <strong>{group.company}</strong>
                  <span>{group.jobs.length}</span>
                </header>
                <div className="library-company__jobs">
                  {group.jobs.map((item) => {
                    const role =
                      item.data?.libraryRole || item.data?.role || "未命名岗位";
                    const locations = item.data?.locations?.join("、") || "Base 待确认";
                    return (
                      <article className="library-job" key={item.id}>
                        <button
                          type="button"
                          className="library-job__main"
                          onClick={() => onSelect(item)}
                        >
                          <strong>{role}</strong>
                          <span>{locations}</span>
                          <small>
                            {MODE_LABELS[item.mode] || "岗位卡片"} / {formatDate(item.updatedAt)}
                          </small>
                        </button>
                        <div className="library-job__actions">
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            aria-label={`修改 ${role}`}
                            title="修改"
                          >
                            <PencilSimple size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(item)}
                            aria-label={`删除 ${role}`}
                            title="删除"
                          >
                            <Trash size={16} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
