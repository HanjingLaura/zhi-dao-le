import React, { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { enforceJdMode, normalizeStructuredJd } from "../lib/jd.js";

const listText = (items) => (Array.isArray(items) ? items.join("\n") : "");
const splitLines = (value) =>
  String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
const splitLocations = (value) =>
  String(value || "")
    .split(/[、，,；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const toForm = (input) => {
  const data = normalizeStructuredJd(input);
  return {
    libraryCompany: data.libraryCompany,
    libraryRole: data.libraryRole,
    company: data.company,
    role: data.role,
    locations: data.locations.join("、"),
    summary: data.summary,
    responsibilities: listText(data.responsibilities),
    requirements: listText(data.requirements),
    bonusPoints: listText(data.bonusPoints),
    companyUrl: data.companyUrl
  };
};

export default function JobEditorDialog({
  open,
  data,
  mode,
  saving,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(() => toForm(data));
  const firstInputRef = useRef(null);
  const dialogRef = useRef(null);
  const savingRef = useRef(saving);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    if (!open) return undefined;
    setForm(toForm(data));
    const timer = setTimeout(() => firstInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [data, open]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])];
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
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [onClose, open]);

  if (!open) return null;

  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    onSave(
      enforceJdMode(
        {
          ...data,
          libraryCompany: form.libraryCompany,
          libraryRole: form.libraryRole,
          company: form.company,
          role: form.role,
          locations: splitLocations(form.locations),
          summary: form.summary,
          responsibilities: splitLines(form.responsibilities),
          requirements: splitLines(form.requirements),
          bonusPoints: splitLines(form.bonusPoints),
          companyUrl: form.companyUrl,
          companyUrlConfidence: form.companyUrl ? "high" : "none",
          companyUrlSource: form.companyUrl ? "provided" : "none",
          companyUrlType: form.companyUrl ? "official" : "none"
        },
        mode
      )
    );
  };

  return (
    <div className="edit-layer" role="presentation" onMouseDown={saving ? undefined : onClose}>
      <form
        ref={dialogRef}
        className="job-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-editor-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="job-editor-title">修改岗位卡片</h2>
            <p>直接保存不会调用 AI</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭">
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="job-editor__body">
          <fieldset className="job-editor__group job-editor__group--private">
            <legend>岗位库内分类</legend>
            <p>只用于当前浏览器的分类和搜索，不会出现在卡片中。</p>
            <div className="job-editor__columns">
              <label>
                <span>公司</span>
                <input ref={firstInputRef} value={form.libraryCompany} onChange={update("libraryCompany")} />
              </label>
              <label>
                <span>岗位</span>
                <input value={form.libraryRole} onChange={update("libraryRole")} />
              </label>
            </div>
          </fieldset>

          <fieldset className="job-editor__group">
            <legend>卡片内容</legend>
            <div className="job-editor__columns">
              <label>
                <span>对外公司名</span>
                <input
                  value={mode === "confidential" ? "保密公司" : form.company}
                  onChange={update("company")}
                  disabled={mode === "confidential"}
                />
              </label>
              <label>
                <span>岗位名称</span>
                <input value={form.role} onChange={update("role")} />
              </label>
            </div>
            <label>
              <span>Base</span>
              <input value={form.locations} onChange={update("locations")} placeholder="北京、上海" />
            </label>
            <label>
              <span>岗位概述</span>
              <textarea value={form.summary} onChange={update("summary")} rows={3} />
            </label>
            <div className="job-editor__columns job-editor__columns--lists">
              <label>
                <span>岗位职责，每行一条</span>
                <textarea value={form.responsibilities} onChange={update("responsibilities")} rows={6} />
              </label>
              <label>
                <span>任职要求，每行一条</span>
                <textarea value={form.requirements} onChange={update("requirements")} rows={6} />
              </label>
            </div>
            <label>
              <span>加分项，每行一条</span>
              <textarea value={form.bonusPoints} onChange={update("bonusPoints")} rows={3} />
            </label>
            {mode !== "confidential" ? (
              <label>
                <span>公司官网或相关链接</span>
                <input type="url" value={form.companyUrl} onChange={update("companyUrl")} placeholder="https://" />
              </label>
            ) : null}
          </fieldset>
        </div>

        <footer>
          <button type="button" className="secondary-action" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="submit" className="save-action" disabled={saving}>
            {saving ? "正在保存" : "保存修改"}
          </button>
        </footer>
      </form>
    </div>
  );
}
