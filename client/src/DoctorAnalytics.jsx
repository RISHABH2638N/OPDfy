import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Calendar, Clock3, FileText, RefreshCw, Star, Users } from "lucide-react";
import { api } from "./api";
import { socket } from "./socket";
import { useLanguage, Trans } from "./LanguageContext";

const n = (value) => Number(value || 0).toLocaleString("en-IN");
const percent = (value) => `${Number(value || 0).toFixed(1)}%`;

function VolumeChart({ rows, t }) {
  const groups = useMemo(() => {
    const step = Math.max(1, Math.ceil(rows.length / 24));
    return Array.from({ length: Math.ceil(rows.length / step) }, (_, index) => {
      const part = rows.slice(index * step, (index + 1) * step);
      return { date: part[0]?.date, endDate: part.at(-1)?.date, total: part.reduce((sum, row) => sum + row.total, 0), completed: part.reduce((sum, row) => sum + row.completed, 0) };
    });
  }, [rows]);
  const max = Math.max(1, ...groups.map((row) => row.total));
  return <div className="doctor-analytics-chart" role="img" aria-label={t("Daily patient volume and completed visits")}>{groups.map((row, index) => <div className="doctor-analytics-column" key={row.date} title={`${row.date}${row.date === row.endDate ? "" : ` – ${row.endDate}`}: ${row.total} ${t("visits")}, ${row.completed} ${t("completed")}`}>
    <div className="doctor-analytics-bars"><span style={{ height: `${Math.max(row.total ? 5 : 0, row.total / max * 100)}%` }}/><i style={{ height: `${Math.max(row.completed ? 5 : 0, row.completed / max * 100)}%` }}/></div>
    {(index % Math.max(1, Math.ceil(groups.length / 6)) === 0 || index === groups.length - 1) && <small>{row.date?.slice(5)}</small>}
  </div>)}</div>;
}

export default function DoctorAnalytics() {
  const { t } = useLanguage();
  const [range, setRange] = useState("1");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    if (range === "custom" && (!from || !to)) { setLoading(false); return; }
    setLoading(true); setError(""); setData(null);
    try {
      const params = range === "custom" ? { startDate: from, endDate: to } : { range };
      const response = await api.get("/doctor/analytics", { params });
      if (!response.data?.period || !response.data?.overview) throw new Error("Unable to load your analytics.");
      if (id === requestId.current) setData(response.data);
    } catch (requestError) { if (id === requestId.current) setError(requestError.userMessage || requestError.response?.data?.message || "Unable to load your analytics."); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [range, from, to, refreshKey]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onUpdate = (event) => {
      if (["queue", "appointments", "analytics", "feedback", "referrals"].some((domain) => event?.domains?.includes(domain))) setRefreshKey((value) => value + 1);
    };
    socket.on("operations:updated", onUpdate);
    return () => socket.off("operations:updated", onUpdate);
  }, []);

  const overview = data?.overview || {};
  const cards = [
    ["Patients handled", n(overview.patientsHandled), Users], ["Completed", n(overview.completed), Activity],
    ["Waiting in your department", n(overview.waitingNow), Clock3], ["Skipped", n(overview.skipped), Activity],
    ["On hold now", n(overview.held), Clock3], ["No-shows", n(overview.noShows), Users],
    ["Average wait", `${n(overview.averageWaitMinutes)} min`, Clock3], ["Median wait", `${n(overview.medianWaitMinutes)} min`, Clock3],
    ["P90 wait", `${n(overview.p90WaitMinutes)} min`, Clock3], ["Avg. consultation", `${n(overview.averageConsultationMinutes)} min`, Activity],
    ["Emergency cases", n(overview.emergency), Activity], ["Prescriptions", n(overview.prescriptions), FileText],
  ];

  return <div className="doctor-analytics-workspace">
    <header className="doctor-analytics-header"><div><p className="eyebrow"><Trans text={"PERSONAL PERFORMANCE"}/></p><h2><Trans text={"My Analytics"}/></h2><p><Trans text={"Your own clinic visits, patient experience and care trends."}/></p></div><button type="button" className="ghost" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCw size={16}/><Trans text={"Refresh"}/></button></header>
    <div className="doctor-analytics-filters" role="group" aria-label={t("Analytics date range")}>{[["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["custom", "Custom dates"]].map(([value, label]) => <button type="button" key={value} className={range === value ? "active" : ""} onClick={() => { setRange(value); setData(null); }} aria-pressed={range === value}>{t(label)}</button>)}
      {range === "custom" && <div className="doctor-analytics-date-fields"><label><Trans text={"From"}/><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)}/></label><label><Trans text={"To"}/><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)}/></label></div>}
    </div>
    {range === "custom" && (!from || !to) && <p className="doctor-analytics-period"><Trans text={"Select both dates to load your analytics."}/></p>}
    {error && <p className="reception-alert error" role="alert">{t(error)}</p>}
    {loading && !data && <div className="doctor-analytics-loading" role="status"><Trans text={"Loading your analytics..."}/></div>}
    {data && <>
      <p className="doctor-analytics-period"><Calendar size={15}/>{data.period.startDate} – {data.period.endDate} · {data.period.timezone}</p>
      <div className="doctor-analytics-metrics">{cards.map(([label, value, Icon]) => <article className="card" key={label}><span><Icon size={17}/>{t(label)}</span><strong>{value}</strong></article>)}</div>
      <div className="doctor-analytics-main-grid">
        <section className="card doctor-analytics-panel"><div className="doctor-analytics-panel-head"><div><p className="eyebrow"><Trans text={"PATIENT FLOW"}/></p><h3><Trans text={"Daily patient volume"}/></h3></div><div className="doctor-chart-legend"><span><i/> <Trans text={"Visits"}/></span><span><i/> <Trans text={"Completed"}/></span></div></div><VolumeChart rows={data.dailyVolume || []} t={t}/></section>
        <section className="card doctor-analytics-panel"><p className="eyebrow"><Trans text={"VISIT MIX"}/></p><h3><Trans text={"Appointments and walk-ins"}/></h3><div className="doctor-analytics-breakdown">{[["Appointments", data.sources?.appointments], ["Walk-ins", data.sources?.walkIns], ["Online reservations", data.sources?.onlineReservations]].map(([label, count]) => <div key={label}><span>{t(label)}<b>{n(count)}</b></span><progress max={Math.max(1, data.overview.totalVisits)} value={count || 0}/></div>)}</div><div className="doctor-analytics-mini-grid"><div><small><Trans text={"First visits with you"}/></small><strong>{n(overview.firstVisits)}</strong></div><div><small><Trans text={"Returning to you"}/></small><strong>{n(overview.repeatVisits)}</strong></div></div></section>
        <section className="card doctor-analytics-panel"><p className="eyebrow"><Trans text={"APPOINTMENT OUTCOMES"}/></p><h3><Trans text={"Scheduled visits"}/></h3><div className="doctor-analytics-mini-grid"><div><small><Trans text={"Total appointments"}/></small><strong>{n(data.appointmentStatus?.total)}</strong></div><div><small><Trans text={"Completed"}/></small><strong>{n(data.appointmentStatus?.completed)}</strong></div><div><small><Trans text={"Completion rate"}/></small><strong>{percent(data.appointmentStatus?.completionRate)}</strong></div><div><small><Trans text={"Cancellation rate"}/></small><strong>{percent(data.appointmentStatus?.cancellationRate)}</strong></div></div><small className="doctor-analytics-note"><Trans text={"Rates use appointments scheduled in this date range."}/></small></section>
        <section className="card doctor-analytics-panel"><p className="eyebrow"><Trans text={"CONTINUITY OF CARE"}/></p><h3><Trans text={"Follow-ups and referrals"}/></h3><div className="doctor-analytics-mini-grid"><div><small><Trans text={"Follow-ups recommended"}/></small><strong>{n(data.followUps?.recommended)}</strong></div><div><small><Trans text={"Follow-ups completed"}/></small><strong>{n(data.followUps?.completed)}</strong></div><div><small><Trans text={"Outgoing referrals"}/></small><strong>{n(data.referrals?.outgoing)}</strong></div><div><small><Trans text={"Incoming referrals"}/></small><strong>{n(data.referrals?.incoming)}</strong></div></div></section>
        <section className="card doctor-analytics-panel"><p className="eyebrow"><Trans text={"BUSIEST HOURS"}/></p><h3><Trans text={"Peak patient arrival time"}/></h3>{data.peakHours?.length ? <div className="doctor-analytics-breakdown">{data.peakHours.map((row) => <div key={row.hour}><span>{String(row.hour).padStart(2,"0")}:00–{String((row.hour + 1) % 24).padStart(2,"0")}:00 <b>{n(row.count)}</b></span><progress max={data.peakHours[0].count} value={row.count}/></div>)}</div> : <p className="muted"><Trans text={"No arrivals in this period."}/></p>}</section>
        <section className="card doctor-analytics-panel"><p className="eyebrow"><Trans text={"PATIENT EXPERIENCE"}/></p><h3><Star size={17}/><Trans text={"Ratings and feedback"}/></h3><div className="doctor-analytics-rating"><strong>{data.feedback?.count ? `${data.feedback.average}/5` : "—"}</strong><span>{n(data.feedback?.count)} <Trans text={"ratings"}/></span></div><div className="doctor-analytics-rating-trend" role="img" aria-label={t("Daily average patient rating")}>{data.feedback?.trend?.filter((row) => row.count).slice(-14).map((row) => <div key={row.date} title={`${row.date}: ${row.average}/5 (${row.count})`}><span style={{ height: `${row.average * 20}%` }}/><small>{row.date.slice(5)}</small></div>)}</div>{!data.feedback?.count && <p className="muted"><Trans text={"No patient ratings in this period."}/></p>}</section>
        <section className="card doctor-analytics-panel"><p className="eyebrow"><Trans text={"CLINICAL SUMMARY"}/></p><h3><FileText size={17}/><Trans text={"Prescriptions and diagnoses"}/></h3><div className="doctor-analytics-mini-grid"><div><small><Trans text={"Prescriptions"}/></small><strong>{n(overview.prescriptions)}</strong></div><div><small><Trans text={"Diagnoses recorded"}/></small><strong>{n(overview.diagnoses)}</strong></div></div>{data.diagnosisSummary?.length ? <div className="doctor-analytics-diagnoses">{data.diagnosisSummary.map((row) => <div key={row.label}><span>{row.label}</span><b>{n(row.count)}</b></div>)}</div> : <p className="muted"><Trans text={"No diagnoses recorded in this period."}/></p>}</section>
      </div>
    </>}
  </div>;
}
