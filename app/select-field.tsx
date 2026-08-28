"use client";

import { KeyboardEvent, useId, useRef, useState } from "react";
import { CaretDown, Check, X } from "@phosphor-icons/react";

export type SelectOption = { value: string; label: string; group?: string; meta?: string };

type SelectFieldProps = {
  name: string;
  label: string;
  options: SelectOption[];
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  sheetTitle?: string;
  emptyLabel?: string;
  closeLabel?: string;
};

export function SelectField({ name, label, options, defaultValue = "", disabled = false, required = false, sheetTitle, emptyLabel, closeLabel = "Close" }: SelectFieldProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const selected = options.find((option) => option.value === value);
  const groups = [...new Set(options.map((option) => option.group ?? ""))];

  function open() {
    if (disabled) return;
    dialogRef.current?.showModal();
    requestAnimationFrame(() => {
      const target = listRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`) ?? listRef.current?.querySelector<HTMLElement>("[role=option]");
      target?.focus();
    });
  }

  function choose(nextValue: string) {
    setValue(nextValue);
    dialogRef.current?.close();
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const choices = [...(listRef.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    if (!choices.length) return;
    const activeIndex = Math.max(0, choices.indexOf(document.activeElement as HTMLElement));
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : event.key === "ArrowDown" ? Math.min(choices.length - 1, activeIndex + 1) : Math.max(0, activeIndex - 1);
    choices[nextIndex]?.focus();
  }

  return <div className="select-field">
    <span className="select-label" id={labelId}>{label}</span>
    <input type="hidden" name={name} value={value} />
    <button className="select-trigger" type="button" onClick={open} disabled={disabled} aria-labelledby={`${labelId} ${listId}`} aria-haspopup="listbox" data-required={required || undefined}>
      <span id={listId} className={selected ? "" : "select-placeholder"}>{selected?.label ?? emptyLabel ?? label}</span>
      {selected?.meta && <small>{selected.meta}</small>}
      <CaretDown aria-hidden="true" weight="bold" />
    </button>
    <dialog className="select-sheet" ref={dialogRef} aria-labelledby={`${labelId}-sheet`} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="select-sheet-panel">
        <header><div><p>{label}</p><h3 id={`${labelId}-sheet`}>{sheetTitle ?? label}</h3></div><button type="button" onClick={() => dialogRef.current?.close()} aria-label={closeLabel}><X aria-hidden="true" /></button></header>
        <div className="select-options" ref={listRef} role="listbox" aria-labelledby={`${labelId}-sheet`} onKeyDown={moveFocus}>
          {groups.map((group) => <section key={group || "default"} aria-label={group || undefined}>
            {group && <p className="select-group-label">{group}</p>}
            {options.filter((option) => (option.group ?? "") === group).map((option) => <button key={option.value || "empty"} type="button" role="option" aria-selected={option.value === value} data-value={option.value} onClick={() => choose(option.value)}>
              <span className="select-orbit" aria-hidden="true"><i /></span><span><strong>{option.label}</strong>{option.meta && <small>{option.meta}</small>}</span>{option.value === value && <Check aria-hidden="true" weight="bold" />}
            </button>)}
          </section>)}
        </div>
      </div>
    </dialog>
  </div>;
}
