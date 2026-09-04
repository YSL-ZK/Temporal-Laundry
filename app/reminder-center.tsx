"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bank, Bell, CalendarDots, CaretRight, CreditCard, HandCoins, X } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import { formatMoney } from "../lib/money";
import { buildFinanceReminders, type FinanceReminder } from "../lib/reminders";

type ReminderDestination = "accounts" | "plans";
type ReminderFilter = "all" | "urgent" | "upcoming";

function reminderIcon(kind: FinanceReminder["kind"]) {
  if (kind === "card") return CreditCard;
  if (kind === "debt") return Bank;
  if (kind === "receivable") return HandCoins;
  return CalendarDots;
}

export function reminderCount(data: DashboardData) {
  return buildFinanceReminders({
    asOf: data.asOf,
    recurring: data.recurringOccurrences,
    statements: data.cardStatements,
    debts: data.debts,
    debtPayments: data.debtPayments,
  }).filter((reminder) => reminder.urgency === "overdue" || reminder.urgency === "today").length;
}

export default function ReminderCenter({ data, language, open, onClose, onNavigate }: { data: DashboardData; language: AppLanguage; open: boolean; onClose: () => void; onNavigate: (destination: ReminderDestination) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<ReminderFilter>("all");
  const t = (copy: string) => translate(language, copy);
  const reminders = useMemo(() => buildFinanceReminders({ asOf: data.asOf, recurring: data.recurringOccurrences, statements: data.cardStatements, debts: data.debts, debtPayments: data.debtPayments }), [data.asOf, data.recurringOccurrences, data.cardStatements, data.debts, data.debtPayments]);
  const urgentCount = reminders.filter((reminder) => reminder.urgency === "overdue" || reminder.urgency === "today").length;
  const visible = reminders.filter((reminder) => filter === "all" || (filter === "urgent" ? reminder.urgency === "overdue" || reminder.urgency === "today" : reminder.urgency === "soon" || reminder.urgency === "upcoming"));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function openReminder(reminder: FinanceReminder) {
    onNavigate(reminder.destination);
    onClose();
  }

  const urgencyLabel = (reminder: FinanceReminder) => t(reminder.urgency === "overdue" ? "Overdue" : reminder.urgency === "today" ? "Due today" : reminder.urgency === "soon" ? "Due soon" : "Upcoming");
  const kindLabel = (kind: FinanceReminder["kind"]) => t(kind === "card" ? "Card statement" : kind === "debt" ? "Debt payment" : kind === "receivable" ? "Expected collection" : "Recurring item");

  return <dialog ref={dialogRef} className="reminder-dialog" aria-labelledby="reminder-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="reminder-sheet">
      <header className="reminder-sheet-header"><span aria-hidden="true"><Bell weight="duotone" /></span><div><p className="eyebrow">{t("MONEY IN MOTION")}</p><h2 id="reminder-title">{t("Reminder center")}</h2><p>{t("Deadlines derived from your authorized ledger records.")}</p></div><button type="button" className="reminder-close" onClick={onClose} aria-label={t("Close reminders")} autoFocus><X aria-hidden="true" /></button></header>
      <div className="reminder-summary" aria-label={t("Reminder summary")}><span><strong>{urgentCount}</strong><small>{t("Need attention")}</small></span><span><strong>{reminders.length - urgentCount}</strong><small>{t("Coming next")}</small></span><span><strong>{reminders.length}</strong><small>{t("Open reminders")}</small></span></div>
      <div className="reminder-filters" role="group" aria-label={t("Filter reminders")}>{(["all", "urgent", "upcoming"] as const).map((value) => <button type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{t(value === "all" ? "All" : value === "urgent" ? "Needs attention" : "Upcoming")}</button>)}</div>
      <div className="reminder-list" aria-live="polite">
        {visible.length ? visible.map((reminder) => { const Icon = reminderIcon(reminder.kind); return <article className={`reminder-row ${reminder.urgency}`} key={reminder.id}><span className="reminder-kind-icon" aria-hidden="true"><Icon weight="duotone" /></span><div className="grow"><span className="reminder-meta"><b>{urgencyLabel(reminder)}</b><i>{kindLabel(reminder.kind)}</i><i>{t(reminder.visibility === "private" ? "Private" : "Shared")}</i></span><strong>{reminder.title}</strong><small>{reminder.detail ? `${reminder.detail} · ` : ""}{new Intl.DateTimeFormat(localeFor(language), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${reminder.dueOn}T12:00:00Z`))}</small></div><div className="reminder-value">{reminder.amount === null ? <span>{t("Review balance")}</span> : <strong>{formatMoney(reminder.amount, reminder.currency, localeFor(language))}</strong>}<button type="button" onClick={() => openReminder(reminder)} aria-label={`${t("Open")} ${reminder.title}`}>{t(reminder.destination === "accounts" ? "Open accounts" : "Open plans")}<CaretRight aria-hidden="true" /></button></div></article>; }) : <div className="reminder-empty"><span aria-hidden="true"><Bell weight="duotone" /></span><strong>{t("Nothing needs attention")}</strong><p>{t("There are no open deadlines in this filter.")}</p></div>}
      </div>
      <footer><p>{t("Reminders are calculated from current records and are not browser notifications.")}</p></footer>
    </section>
  </dialog>;
}
