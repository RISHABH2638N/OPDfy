import React, { useEffect, useRef, useState } from "react";
import { Activity, BarChart3, Building2, Calendar, CheckCircle, Clock3, Download, IndianRupee, Plus, RefreshCw, Settings2, ShieldCheck, Users, X } from "lucide-react";
import { Link } from "react-router-dom";
import { platformApi } from "./api";
import { useLanguage } from "./LanguageContext";
import "./platform-analytics.css";

const count = value => Number(value || 0).toLocaleString("en-IN");
const money = paise => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(paise || 0) / 100);
const indiaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateText = value => value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const plans = ["Starter", "Growth", "Enterprise", "Custom"];
const cycles = [["monthly", "Monthly"], ["yearly", "Yearly"], ["setup", "Setup fee"]];
const methods = [["upi", "UPI"], ["cash", "Cash"], ["card", "Card"], ["bank_transfer", "Bank transfer"], ["other", "Other"]];

function PatientChart({ rows, title, t }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  const width = 560, step = width / Math.max(1, rows.length);
  return <section className="pa-card pa-chart"><div className="pa-section-heading"><h2>{t(title)}</h2><BarChart3 size={19}/></div>
    {!rows.some(row => row.count) ? <p className="pa-empty">{t("No checked-in patients in this period.")}</p> : <>
      <svg className="pa-chart-svg" viewBox="0 0 600 195" role="img" aria-label={t(title)}><title>{t(title)}</title>{rows.length > 14 && <text x="20" y="18">{count(max)}</text>}<line x1="20" y1="158" x2="580" y2="158"/>{rows.map((row, index) => {
        const height = row.count / max * 125, x = 20 + index * step + step * .15;
        const label = rows.length <= 7 || index % Math.ceil(rows.length / 5) === 0 || index === rows.length - 1;
        return <g key={row.date}><rect x={x} y={158 - height} width={Math.max(.5, step * .7)} height={height} rx={Math.min(4, step * .15)} tabIndex={row.count ? 0 : undefined} aria-label={`${row.date}: ${count(row.count)} ${t("Patients")}`}><title>{row.date}: {count(row.count)} {t("Patients")}</title></rect>{rows.length <= 14 && <text x={x + step * .35} y={Math.max(18, 150 - height)} textAnchor="middle">{count(row.count)}</text>}{label && <text x={20 + index * step + step / 2} y="182" textAnchor="middle">{row.date.length === 7 ? row.date : row.date.slice(5)}</text>}</g>;
      })}</svg>
      <details className="pa-chart-data"><summary>{t("View chart data")}</summary><div className="pa-table-scroll"><table><thead><tr><th scope="col">{t("Date")}</th><th scope="col">{t("Patients")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{count(row.count)}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

export function InvoiceGenerator({ clinic, clinics, onClose, t }) {
  const ref = useRef(null);
  const [clinicId, setClinicId] = useState(clinic?.id || clinics[0]?.id || ""), [cycle, setCycle] = useState(""), [status, setStatus] = useState("");
  const [rows, setRows] = useState([]), [cursor, setCursor] = useState(null), [before, setBefore] = useState(""), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false), [downloading, setDownloading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    if (!clinicId) return;
    const controller = new AbortController(); setLoading(true); setError("");
    platformApi.get("/platform/subscription-invoices", { params: { clinicId, ...(cycle ? { billingCycle: cycle } : {}), ...(status ? { status } : {}), ...(before ? { before } : {}) }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) { setRows(current => before ? [...current, ...data.invoices] : data.invoices); setCursor(data.nextCursor); } })
      .catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.message || "Unable to load invoices."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clinicId, cycle, status, before]);
  const filter = (setter, value) => { setter(value); setBefore(""); setRows([]); setSelected(""); setCursor(null); setNotice(""); };
  async function download() {
    if (!selected || downloading) return;
    setDownloading(true); setError(""); setNotice("");
    try {
      const response = await platformApi.get(`/platform/subscription-invoices/${selected}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data), link = document.createElement("a");
      link.href = url; link.download = `OPD-${selected.toUpperCase()}.pdf`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Invoice downloaded.");
    } catch (err) {
      let message = "Unable to download invoice.";
      try { const body = err.response?.data; message = (body instanceof Blob ? JSON.parse(await body.text()) : body)?.message || message; } catch {}
      setError(message);
    } finally { setDownloading(false); }
  }
  const invoice = rows.find(row => row._id === selected);
  return <dialog ref={ref} className="pa-dialog pa-generator" aria-labelledby="pa-generator-title" onCancel={event => { event.preventDefault(); if (!downloading) onClose(); }}>
    <header><div><p className="pa-eyebrow">{t("SUBSCRIPTION INVOICE DOWNLOAD")}</p><h2 id="pa-generator-title">{t("Generate invoice")}</h2></div><button type="button" className="pa-icon" disabled={downloading} onClick={onClose} aria-label={t("Close")}><X size={19}/></button></header>
    <div className="pa-generator-body">
    <p className="pa-note">{t("Choose a recorded subscription or setup payment. Downloads do not create new charges. Clinic patient payments are not included.")}</p>
    <label>{t("Clinic")}<select aria-label={t("Clinic")} value={clinicId} disabled={downloading} onChange={e => filter(setClinicId, e.target.value)}>{clinics.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <div className="pa-form-grid"><label>{t("Payment type")}<select aria-label={t("Payment type")} value={cycle} disabled={downloading} onChange={e => filter(setCycle, e.target.value)}><option value="">{t("All payment types")}</option>{cycles.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      <label>{t("Invoice status")}<select aria-label={t("Invoice status")} value={status} disabled={downloading} onChange={e => filter(setStatus, e.target.value)}><option value="">{t("All statuses")}</option>{["paid", "pending", "void"].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div>
    {error && <p className="pa-alert error" role="alert">{t(error)}</p>}{notice && <p className="pa-alert" role="status">{t(notice)}</p>}
    {loading && <p className="pa-note" role="status">{t("Loading invoices...")}</p>}
    {!!rows.length && <label>{t("Select invoice")}<select aria-label={t("Select invoice")} value={selected} disabled={loading || downloading} onChange={e => { setSelected(e.target.value); setNotice(""); }}><option value="">{t("Choose an invoice")}</option>{rows.map(row => <option key={row._id} value={row._id}>{dateText(row.createdAt)} · {t(row.plan)} · {t(cycles.find(([value]) => value === row.billingCycle)?.[1])} · {money(row.amountPaise)} · {t(row.status)} · #{row._id.slice(-8).toUpperCase()}</option>)}</select></label>}
    {!loading && !rows.length && !error && <p className="pa-empty">{t("No invoices match. Record an invoice first or change the filters.")}</p>}
    {cursor && <button type="button" className="pa-button secondary" disabled={loading || downloading} onClick={() => setBefore(cursor)}>{t("Load older invoices")}</button>}
    {invoice && <div className="pa-invoice-preview"><span>{t("Invoice number")}<b>OPD-{invoice._id.toUpperCase()}</b></span><span>{t("Amount")}<strong>{money(invoice.amountPaise)}</strong></span><span>{t("Payment method")}<b>{invoice.method ? t(methods.find(([value]) => value === invoice.method)?.[1]) : "—"}</b></span><span>{t("Payment date")}<b>{dateText(invoice.paidAt)}</b></span></div>}
    <p className="pa-note">{t("PDF invoices are in English. Tax details are not configured; this is not a GST tax invoice.")}</p>
    </div>
    <footer><button type="button" className="pa-button secondary" onClick={onClose} disabled={downloading}>{t("Close")}</button><button type="button" className="pa-button" onClick={download} disabled={!invoice || loading || downloading}><Download size={16}/>{t(downloading ? "Downloading..." : "Download PDF")}</button></footer>
  </dialog>;
}

function Editor({ editor, clinics, busy, onClose, onSave, t }) {
  const ref = useRef(null);
  const today = indiaDate();
  const [form, setForm] = useState(() => {
    const terms = editor.clinic?.terms || {};
    return { clinicId: editor.clinic?.id || clinics[0]?.id || "", plan: terms.plan || "Starter", billingCycle: terms.billingCycle || "monthly",
      amount: terms.feePaise ? String(terms.feePaise / 100) : "", dueDate: today, status: "pending", paidDate: today, method: "upi",
      pilotEndDate: terms.pilotEndsAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(terms.pilotEndsAt)) : "" };
  });
  useEffect(() => { ref.current?.showModal(); }, []);
  const field = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const termsMode = editor.kind === "terms", settle = editor.kind === "settle";
  return <dialog ref={ref} className="pa-dialog" aria-labelledby="pa-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); onSave(form); }}>
      <header><div><p className="pa-eyebrow">{t("MANUAL SUBSCRIPTION BILLING")}</p><h2 id="pa-editor-title">{t(termsMode ? "Clinic subscription terms" : settle ? "Record payment" : "Record subscription invoice")}</h2></div><button type="button" className="pa-icon" onClick={onClose} disabled={busy} aria-label={t("Close")}><X size={19}/></button></header>
      <p className="pa-note">{t("Recording payments here does not renew access. Use Active Clinics to activate or renew the subscription.")}</p>
      {settle && <p className="pa-alert"><strong>{editor.clinic?.name || ""} · {money(editor.invoice.amountPaise)}</strong></p>}
      {editor.error && <p className="pa-alert error" role="alert">{t(editor.error)}</p>}
      {!termsMode && !settle && <label>{t("Clinic")}<select required value={form.clinicId} onChange={e => field("clinicId", e.target.value)}>{clinics.map(clinic => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>}
      {termsMode && <p><strong>{editor.clinic.name}</strong></p>}
      {!settle && <div className="pa-form-grid">
        <label>{t("Plan")}<select value={form.plan} onChange={e => field("plan", e.target.value)}>{plans.map(plan => <option key={plan}>{t(plan)}</option>)}</select></label>
        <label>{t("Billing cycle")}<select value={form.billingCycle} onChange={e => field("billingCycle", e.target.value)}>{cycles.filter(([cycle]) => !termsMode || cycle !== "setup").map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label>{t(termsMode ? "Agreed fee per billing cycle (₹)" : "Amount (₹)")}<input required type="number" min="0.01" max="1000000" step="0.01" value={form.amount} onChange={e => field("amount", e.target.value)}/></label>
        {termsMode ? <label>{t("Pilot end date (optional)")}<input type="date" value={form.pilotEndDate} onChange={e => field("pilotEndDate", e.target.value)}/></label> : <label>{t("Payment due date")}<input required type="date" value={form.dueDate} onChange={e => field("dueDate", e.target.value)}/></label>}
      </div>}
      {!termsMode && !settle && <label>{t("Invoice status")}<select value={form.status} onChange={e => field("status", e.target.value)}><option value="pending">{t("Pending")}</option><option value="paid">{t("Paid")}</option></select></label>}
      {!termsMode && (settle || form.status === "paid") && <div className="pa-form-grid"><label>{t("Payment method")}<select value={form.method} onChange={e => field("method", e.target.value)}>{methods.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label>{t("Payment date")}<input required type="date" max={today} value={form.paidDate} onChange={e => field("paidDate", e.target.value)}/></label></div>}
      <footer><button type="button" className="pa-button secondary" onClick={onClose} disabled={busy}>{t("Cancel")}</button><button type="submit" className="pa-button" disabled={busy}>{t(busy ? "Saving..." : "Save")}</button></footer>
    </form>
  </dialog>;
}

export default function PlatformAnalytics() {
  const { t } = useLanguage();
  const [range, setRange] = useState("30"), [start, setStart] = useState(""), [end, setEnd] = useState(""), [clinicId, setClinicId] = useState("");
  const [data, setData] = useState(null), [options, setOptions] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [editor, setEditor] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [generator, setGenerator] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    if (range === "custom" && (!start || !end)) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    platformApi.get("/platform/analytics", { params: { ...(range === "custom" ? { startDate: start, endDate: end } : { range }), ...(clinicId ? { clinicId } : {}) }, signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) { setData(response.data); setOptions(response.data.clinicOptions || []); } })
      .catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.message || "Unable to load platform analytics."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, start, end, clinicId, refresh]);
  const open = (kind, clinic, invoice) => { setNotice(""); setEditor({ kind, clinic, invoice, requestId: crypto.randomUUID(), error: "" }); };
  async function save(form) {
    setBusy(true);
    try {
      let response;
      const amountPaise = Math.round(Number(form.amount) * 100);
      if (editor.kind === "terms") response = await platformApi.put(`/platform/clinics/${editor.clinic.id}/analytics-terms`, { plan: form.plan, billingCycle: form.billingCycle, feePaise: amountPaise, pilotEndDate: form.pilotEndDate });
      else if (editor.kind === "settle") response = await platformApi.patch(`/platform/subscription-invoices/${editor.invoice._id}`, { status: "paid", method: form.method, paidDate: form.paidDate });
      else response = await platformApi.post("/platform/subscription-invoices", { clinicId: form.clinicId, plan: form.plan, billingCycle: form.billingCycle, amountPaise, dueDate: form.dueDate, status: form.status, method: form.method, paidDate: form.paidDate, requestId: editor.requestId });
      setEditor(null); setNotice(response.data.message); setRefresh(value => value + 1);
    } catch (err) { setEditor(current => ({ ...current, error: err.response?.data?.message || "Unable to save subscription record." })); }
    finally { setBusy(false); }
  }
  async function voidInvoice(invoice) {
    if (!window.confirm(t("Void this pending invoice?"))) return;
    setBusy(true); setNotice("");
    try { const result = await platformApi.patch(`/platform/subscription-invoices/${invoice._id}`, { status: "void" }); setNotice(result.data.message); setRefresh(value => value + 1); }
    catch (err) { setError(err.response?.data?.message || "Unable to save subscription record."); }
    finally { setBusy(false); }
  }
  const o = data?.overview;
  const cards = o ? [
    ["Clinics", count(o.total), Building2], ["Active Clinics", count(o.active), Activity], ["Pilot clinics", count(o.pilots), Clock3],
    ["Doctors", count(o.doctors), Users], ["Staff accounts", count(o.staff), Users], ["Subscription collected", money(o.subscriptionCollectedPaise), IndianRupee],
    ["Outstanding invoices", money(o.outstandingPaise), Calendar], ["Patients on selected date", count(o.dailyPatients), Users],
  ] : [];
  const alertLabel = { pending_payment: "Pending subscription payment", renewal_due: "Renewal within 7 days", pilot_ending: "Pilot ending within 3 days", inactive: "No checked-in patients in the last 30 days" };
  const rowName = id => options.find(clinic => clinic.id === String(id))?.name || "—";
  return <main className="platform-shell pa-workspace">
    <header className="pa-header"><div><p className="pa-eyebrow">{t("PLATFORM ANALYTICS")}</p><h1>{t("Your clinics, at a glance")}</h1><p>{t("Clinic activity and recorded subscription collections in one view.")}</p></div><button className="pa-button secondary" type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16}/>{t("Refresh")}</button></header>
    <section className="pa-card pa-filters" aria-label={t("Analytics filters")}><div className="pa-range">{[["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["custom", "Custom dates"]].map(([value, label]) => <button type="button" key={value} aria-pressed={range === value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>{t(label)}</button>)}</div><label>{t("Clinic")}<select aria-label={t("Clinic")} value={clinicId} onChange={e => setClinicId(e.target.value)}><option value="">{t("All clinics")}</option>{options.map(clinic => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
      {range === "custom" && <div className="pa-date-fields"><label>{t("From")}<input type="date" max={end || indiaDate()} value={start} onChange={e => setStart(e.target.value)}/></label><label>{t("To")}<input type="date" min={start || undefined} max={indiaDate()} value={end} onChange={e => setEnd(e.target.value)}/></label></div>}
    </section>
    {notice && <p className="pa-alert" role="status"><CheckCircle size={16}/>{t(notice)}</p>}
    {error && <p className="pa-alert error" role="alert">{t(error)}</p>}
    {loading && <p className="pa-card pa-empty" role="status">{t("Loading platform analytics...")}</p>}
    {range === "custom" && (!start || !end) && <p className="pa-note">{t("Select both dates to load your analytics.")}</p>}
    {data && <>
      <p className="pa-period"><Calendar size={15}/>{data.period.startDate} – {data.period.endDate} · Asia/Kolkata <span>{t("Collections use payment date; outstanding invoices include all dates.")}</span></p>
      <section className="pa-metrics" aria-label={t("Platform overview")}>{cards.map(([label, value, Icon]) => <article className="pa-card pa-metric" key={label}><span><Icon size={18}/>{t(label)}</span><strong>{value}</strong></article>)}</section>
      <div className="pa-status-line">{[["pending", "Pending Clinics"], ["suspended", "Suspended"], ["expired", "Expired"], ["rejected", "Rejected"]].map(([key, label]) => <span key={key}>{t(label)} <b>{count(o[key])}</b></span>)}<span>{t("Patients this calendar month")} <b>{count(o.monthlyPatients)}</b></span></div>
      <div className="pa-chart-grid"><PatientChart rows={data.dailyTrend} title="Patients per day" t={t}/><PatientChart rows={data.monthlyTrend} title="Patients per month" t={t}/></div>
      <p className="pa-note"><ShieldCheck size={16}/>{t("Counts use checked-in tokens by creation date. Each linked patient is counted once per clinic per day or calendar month. Monthly counts run from the start of the month through the report end date. Patient identities are not returned.")}</p>
      <section className="pa-card"><div className="pa-section-heading"><div><h2>{t("Clinic activity & subscriptions")}</h2><p>{t("Daily counts refer to the report end date. Monthly counts refer to its calendar month.")}</p></div><div className="pa-header-actions"><button type="button" className="pa-button" onClick={() => open("invoice")} disabled={!options.length || busy}><Plus size={16}/>{t("Record invoice")}</button><button type="button" className="pa-button secondary" disabled={!options.length || busy} onClick={() => setGenerator({})}><Download size={16}/>{t("Generate invoice")}</button></div></div>
        <div className="pa-table-scroll" tabIndex={0} role="region" aria-label={t("Clinic activity & subscriptions")}><table><thead><tr>{["Clinic", "Patients per day", "Patients per month", "Plan / cycle", "Subscription collected", "Outstanding invoices", "Next renewal", "Actions"].map(label => <th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.clinics.map(clinic => <tr key={clinic.id}><th scope="row"><b>{clinic.name}</b><small><span className={`pa-badge ${clinic.status}`}>{t(clinic.status)}</span>{clinic.pilot && <span className="pa-badge">{t("Pilot")}</span>}</small></th><td>{count(clinic.dailyPatients)}</td><td>{count(clinic.monthlyPatients)}</td><td>{clinic.terms.plan ? t(clinic.terms.plan) : t("Not configured")}<small>{clinic.terms.billingCycle && `${t(clinic.terms.billingCycle === "yearly" ? "Yearly" : "Monthly")} · ${money(clinic.terms.feePaise)}`}</small></td><td>{money(clinic.subscriptionCollectedPaise)}</td><td>{money(clinic.outstandingPaise)}</td><td>{dateText(clinic.renewalAt)}</td><td><div className="pa-row-actions"><button className="pa-button secondary" type="button" onClick={() => open("terms", clinic)} disabled={busy}><Settings2 size={14}/>{t("Configure")}</button><button className="pa-button secondary" type="button" onClick={() => open("invoice", clinic)} disabled={busy}>{t("Record invoice")}</button><button className="pa-button secondary" type="button" disabled={busy} onClick={() => setGenerator({ clinic })}><Download size={14}/>{t("Generate invoice")}</button></div></td></tr>)}</tbody></table></div>
        {!data.clinics.length && <p className="pa-empty">{t("No clinics available.")}</p>}
      </section>
      <div className="pa-chart-grid"><section className="pa-card"><div className="pa-section-heading"><h2>{t("Feature adoption")}</h2><Activity size={18}/></div><p className="pa-note">{t("Clinics with recorded activity in the selected period. Viewing an analytics screen is not tracked.")}</p>{[["appointments", "Appointment booking"], ["queue", "Token queues"], ["prescriptions", "Digital prescriptions"], ["patientBooking", "Patient online booking"]].map(([key, label]) => <div className="pa-adoption" key={key}><span>{t(label)}</span><b>{count(data.adoption[key])} / {count(o.total)}</b><progress aria-label={t(label)} value={data.adoption[key]} max={Math.max(1, o.total)}/></div>)}</section>
      <section className="pa-card"><div className="pa-section-heading"><h2>{t("Attention needed")}</h2><Clock3 size={18}/></div><div className="pa-alert-list">{data.alerts.map((alert, index) => <div key={`${alert.clinicId}-${alert.type}-${index}`}><b>{alert.clinicName}</b><span>{t(alertLabel[alert.type])}</span><small>{alert.date ? dateText(alert.date) : alert.type === "pending_payment" ? money(alert.value) : ""}</small></div>)}{!data.alerts.length && <p className="pa-empty">{t("No alerts at the moment.")}</p>}</div><Link className="pa-text-link" to="/platform?view=active">{t("Manage clinic subscriptions")}</Link></section></div>
      <section className="pa-card"><div className="pa-section-heading"><div><h2>{t("Subscription payment ledger")}</h2><p>{t("Only manually recorded invoices contribute to subscription amounts. Historic renewal notes do not contain payment amounts.")}</p></div></div><div className="pa-table-scroll" tabIndex={0} role="region" aria-label={t("Subscription payment ledger")}><table><thead><tr>{["Clinic", "Plan / cycle", "Amount", "Payment due date", "Status", "Payment date", "Payment method", "Actions"].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{data.invoices.map(invoice => <tr key={invoice._id}><th scope="row">{rowName(invoice.tenantId)}<small>#{invoice._id.slice(-8).toUpperCase()}</small></th><td>{t(invoice.plan)}<small>{t(cycles.find(([value]) => value === invoice.billingCycle)?.[1])}</small></td><td>{money(invoice.amountPaise)}</td><td>{invoice.dueDate}</td><td><span className={`pa-badge ${invoice.status}`}>{t(invoice.status)}</span></td><td>{dateText(invoice.paidAt)}</td><td>{invoice.method ? t(methods.find(([value]) => value === invoice.method)?.[1]) : "—"}</td><td>{invoice.status === "pending" && <div className="pa-row-actions"><button type="button" className="pa-button secondary" disabled={busy} onClick={() => open("settle", data.clinics.find(clinic => clinic.id === String(invoice.tenantId)), invoice)}>{t("Record payment")}</button><button type="button" className="pa-button danger" disabled={busy} onClick={() => voidInvoice(invoice)}>{t("Void")}</button></div>}</td></tr>)}</tbody></table></div>{!data.invoices.length && <p className="pa-empty">{t("No subscription invoices recorded yet. Record actual amounts to start tracking collections.")}</p>}{data.invoiceCount > 100 && <p className="pa-note">{t("Showing the latest 100 invoices. Collection and outstanding totals include the full ledger.")}</p>}</section>
      <section className="pa-card"><div className="pa-section-heading"><div><h2>{t("Clinic counter payments")}</h2><p>{t("Recorded patient payments in the selected period. These amounts belong to clinics and are separate from OPDfy subscription income.")}</p></div><IndianRupee size={18}/></div><div className="pa-counter-grid">{data.clinics.map(clinic => <div key={clinic.id}><span>{clinic.name}</span><strong>{money(Math.round(clinic.clinicCounterPayments * 100))}</strong></div>)}</div></section>
    </>}
    {generator && <InvoiceGenerator clinic={generator.clinic} clinics={options} t={t} onClose={() => setGenerator(null)}/>}
    {editor && <Editor editor={editor} clinics={options} busy={busy} t={t} onClose={() => { if (!busy) setEditor(null); }} onSave={save}/>}
  </main>;
}
