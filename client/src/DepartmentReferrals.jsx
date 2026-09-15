import { localizeUi } from "./i18n.js";
import { useLanguage, Trans } from "./LanguageContext";
import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { socket } from "./socket";
import "./department-referrals.css";

const refId = (value) => String(value?._id || value || "");
const message = (error) => error?.response?.data?.message || "Unable to process referral. Please try again.";
const displayDate = (value) => value ? new Date(value).toLocaleString("en-IN") : "—";

function useReferrals() {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/referrals");
      setReferrals(data.referrals || []);
      setError("");
    } catch (error) { setError(message(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    setLoading(true);
    refresh();
    const onUpdate = (event) => {
      if (event?.domains?.includes("referrals") || event?.domains?.includes("queue")) refresh();
    };
    socket.on("operations:updated", onUpdate);
    socket.on("connect", refresh);
    return () => {
      socket.off("operations:updated", onUpdate);
      socket.off("connect", refresh);
    };
  }, [refresh]);
  return { referrals, loading, error, refresh };
}

function ReferralStatus({ status }) {
  const { t } = useLanguage();
  return <span className={`referral-status referral-status-${status}`}>{String(status || "pending").replaceAll("_", " ")}</span>;
}

export function DoctorReferrals({ currentDoctor, activeToken, recentTokens = [] }) {
  const { t } = useLanguage();
  const { referrals, loading, error, refresh } = useReferrals();
  const [doctors, setDoctors] = useState([]);
  const [tokenId, setTokenId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState("routine");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [clinical, setClinical] = useState(null);
  const [clinicalError, setClinicalError] = useState("");
  const ownId = refId(currentDoctor?.id || currentDoctor?._id);
  const possibleTokens = [activeToken, ...recentTokens]
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((entry) => refId(entry._id) === refId(item._id)) === index)
    .filter((item) => item.patient && ["called", "completed"].includes(item.status));
  const selectedToken = tokenId || refId(activeToken?._id);
  const destinations = doctors.filter((doctor) => doctor.department !== currentDoctor?.department && refId(doctor._id) !== ownId);
  const selectedDoctor = destinations.find((doctor) => refId(doctor._id) === doctorId);

  useEffect(() => {
    api.get("/referrals/doctors").then(({ data }) => setDoctors(data.doctors || []))
      .catch(() => setDoctors([]));
  }, []);
  useEffect(() => { if (activeToken?._id) setTokenId(refId(activeToken._id)); }, [activeToken?._id]);

  const submit = async (event) => {
    event.preventDefault();
    setNotice("");
    if (!selectedToken || !doctorId || !reason.trim()) return;
    setBusy(true);
    try {
      await api.post("/referrals", { tokenId: selectedToken, doctorId, reason: reason.trim(), priority });
      setReason(""); setDoctorId(""); setNotice("Referral sent to reception. The patient will receive a new token after check-in and payment confirmation.");
      await refresh();
    } catch (error) { setNotice(message(error)); }
    finally { setBusy(false); }
  };

  const cancel = async (referral) => {
    if (!window.confirm(localizeUi("Cancel this pending referral?"))) return;
    setBusy(true);
    try {
      await api.post(`/referrals/${referral._id}/cancel`);
      setNotice("Referral cancelled."); await refresh();
    } catch (error) { setNotice(message(error)); }
    finally { setBusy(false); }
  };

  const viewClinical = async (referral) => {
    setClinicalError(""); setClinical(null);
    try {
      const { data } = await api.get(`/referrals/${referral._id}/clinical`);
      setClinical(data);
    } catch (error) { setClinicalError(message(error)); }
  };

  return <details className="card referral-workspace">
    <summary><strong><Trans text={"Department Referrals"} /></strong><span className="muted"><Trans text={"Refer to another specialty or review incoming referrals"} /></span></summary>
    <div className="referral-content">
      <div className="referral-panel">
        <h3><Trans text={"Refer patient to another doctor"} /></h3>
        <p className="muted"><Trans text={"The patient keeps their original consultation. A separate destination queue token is issued by reception."} /></p>
        <form onSubmit={submit} className="referral-form">
          <label><Trans text={"Source encounter"} /><select value={selectedToken} onChange={(e) => setTokenId(e.target.value)} required>
              <option value="">{t("Select patient encounter")}</option>
              {possibleTokens.map((token) => <option key={token._id} value={token._id}>#{token.tokenNumber} · {token.patientName} · {t(token.department)} ({t(token.status)})</option>)}
            </select>
          </label>
          <label><Trans text={"Target department and doctor"} /><select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
              <option value="">{t("Select doctor")}</option>
              {destinations.map((doctor) => <option key={doctor._id} value={doctor._id}>{t(doctor.department)} {t("· Dr. ")}{doctor.name}</option>)}
            </select>
          </label>
          {selectedDoctor && <small className="muted">{selectedDoctor.availability?.isAvailable ? t("Doctor is currently available.") : `Current availability: ${t(selectedDoctor.availability?.reason || "Unavailable")}. Reception will confirm availability at check-in.`}</small>}
          <label><Trans text={"Clinical reason for referral"} /><textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason for specialist assessment and relevant clinical findings")} required />
          </label>
          <label><Trans text={"Referral priority"} /><select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="routine">{t("Routine")}</option><option value="urgent">{t("Urgent — staff review required")}</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy || !possibleTokens.length}>{busy ? t("Sending...") : t("Send Referral")}</button>
        </form>
        <small className="muted"><Trans text={"Urgent is a clinical referral flag, not an automatic emergency queue override."} /></small>
      </div>
      <div className="referral-panel">
        <h3><Trans text={"Referral history & incoming visits"} /></h3>
        {loading && <p className="muted"><Trans text={"Loading referrals..."} /></p>}
        {error && <p role="alert" className="login-error">{t(error)}</p>}
        {!referrals.length && !loading && <p className="muted"><Trans text={"No department referrals yet."} /></p>}
        <div className="referral-list">
          {referrals.map((referral) => {
            const incoming = refId(referral.toDoctor) === ownId;
            const target = referral.targetToken;
            const canView = !incoming || (target?.status === "called" && refId(target?.assignedDoctor) === ownId);
            return <article className="referral-entry" key={referral._id}>
              <div className="referral-entry-head"><strong>{incoming ? t("Incoming") : t("Outgoing")} · {referral.patient?.name || t("Patient")}</strong><ReferralStatus status={referral.status} /></div>
              <p>{referral.fromDepartment} → {referral.toDepartment}</p>
              <small><Trans text={"Dr. "} />{referral.fromDoctor?.name || "—"} <Trans text={"→ Dr. "} />{referral.toDoctor?.name || "—"} · {displayDate(referral.createdAt)}</small>
              {target && <p><Trans text={"Destination token #"} />{target.tokenNumber} · {t(target.status)}</p>}
              <div className="referral-actions">
                {canView && <button type="button" className="ghost small" onClick={() => viewClinical(referral)}><Trans text={"View clinical referral"} /></button>}
                {!incoming && referral.status === "pending" && <button type="button" className="ghost small" disabled={busy} onClick={() => cancel(referral)}><Trans text={"Cancel"} /></button>}
              </div>
            </article>;
          })}
        </div>
        {clinicalError && <p role="alert" className="login-error">{t(clinicalError)}</p>}
        {clinical && <div className="referral-clinical" aria-live="polite">
          <h3><Trans text={"Clinical handover"} /></h3>
          <p><strong><Trans text={"Referral reason:"} /></strong> {clinical.referral.reason}</p>
          <p><strong><Trans text={"Source diagnosis:"} /></strong> {clinical.sourceConsultation?.diagnosis || "Consultation record not yet completed."}</p>
          {clinical.sourceConsultation?.symptoms && <p><strong><Trans text={"Symptoms:"} /></strong> {clinical.sourceConsultation.symptoms}</p>}
          {clinical.sourceConsultation?.prescription && <p><strong><Trans text={"Prescription:"} /></strong> {clinical.sourceConsultation.prescription}</p>}
          {clinical.sourceConsultation?.medicines?.length > 0 && <p><strong><Trans text={"Medicines:"} /></strong> {clinical.sourceConsultation.medicines.map((m) => m.name).join(", ")}</p>}
          {clinical.sourceConsultation?.testsRecommended?.length > 0 && <p><strong><Trans text={"Tests:"} /></strong> {clinical.sourceConsultation.testsRecommended.join(", ")}</p>}
          <button className="ghost small" type="button" onClick={() => setClinical(null)}><Trans text={"Close handover"} /></button>
        </div>}
      </div>
    </div>
    {notice && <p className="referral-notice" role="status">{t(notice)}</p>}
  </details>;
}

export function ReceptionReferrals() {
  const { t } = useLanguage();
  const { referrals, loading, error, refresh } = useReferrals();
  const [selected, setSelected] = useState(null);
  const [quote, setQuote] = useState(null);
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [overrideReason, setOverrideReason] = useState("");
  const [transactionReference, setTransactionReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const begin = async (referral) => {
    setNotice(""); setSelected(null); setQuote(null); setBusy(true);
    try {
      const { data } = await api.get(`/referrals/${referral._id}/quote`);
      setQuote(data.quote); setPaidAmount(String(data.quote.amount)); setOverrideReason(""); setTransactionReference(""); setSelected(referral);
    } catch (error) { setNotice(message(error)); }
    finally { setBusy(false); }
  };
  const accept = async (event) => {
    event.preventDefault();
    if (!selected || !quote) return;
    if (!window.confirm(localizeUi("Confirm patient arrival and the recorded payment to issue the destination token?"))) return;
    setBusy(true); setNotice("");
    try {
      const { data } = await api.post(`/referrals/${selected._id}/accept`, {
        paidAmount: quote.amount === 0 ? 0 : Number(paidAmount),
        method, overrideReason, transactionReference,
      });
      setNotice(`Referral accepted. New ${data.token.department} token #${data.token.tokenNumber} issued. Receipt: ${data.token.billing?.receiptNumber || "—"}.`);
      setSelected(null); await refresh();
    } catch (error) { setNotice(message(error)); }
    finally { setBusy(false); }
  };

  return <details className="card referral-workspace">
    <summary><strong><Trans text={"Department Referral Desk"} /></strong><span className="muted"><Trans text={"Confirm arrival, fees and destination token"} /></span></summary>
    <div className="referral-content">
      <div className="referral-panel">
        <h3><Trans text={"Pending referrals"} /></h3>
        {loading && <p className="muted"><Trans text={"Loading..."} /></p>}
        {error && <p className="login-error" role="alert">{t(error)}</p>}
        {!referrals.some((r) => r.status === "pending") && !loading && <p className="muted"><Trans text={"No pending referrals."} /></p>}
        <div className="referral-list">
          {referrals.filter((r) => r.status === "pending").map((r) => <article key={r._id} className="referral-entry">
            <strong>{r.patient?.name || t("Patient")} · {r.patient?.patientId || ""}</strong>
            <p>{r.fromDepartment} → {r.toDepartment}</p>
            <small><Trans text={"Dr. "} />{r.fromDoctor?.name} <Trans text={"→ Dr. "} />{r.toDoctor?.name} · {displayDate(r.createdAt)}</small>
            <div className="referral-actions"><button type="button" className="primary small" disabled={busy} onClick={() => begin(r)}><Trans text={"Confirm & Issue Token"} /></button></div>
          </article>)}
        </div>
      </div>
      <div className="referral-panel">
        <h3><Trans text={"Destination check-in"} /></h3>
        {!selected ? <p className="muted"><Trans text={"Select a pending referral to confirm the destination consultation fee."} /></p> : <form className="referral-form" onSubmit={accept}>
          <p><strong>{selected.patient?.name}</strong><br />{selected.toDepartment} <Trans text={"· Dr. "} />{selected.toDoctor?.name}</p>
          <p><Trans text={"Configured fee: "} /><strong>₹{Number(quote?.amount || 0).toFixed(2)}</strong></p>
          <label><Trans text={"Amount collected (₹)"} /><input type="number" min="0" max={quote?.amount} step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required />
          </label>
          <label><Trans text={"Payment method"} /><select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">{t("Cash")}</option><option value="upi">{t("UPI")}</option><option value="card">{t("Card")}</option><option value="other">{t("Other")}</option>
            </select>
          </label>
          {Number(paidAmount) < Number(quote?.amount || 0) && <label><Trans text={"Discount / waiver reason"} /><textarea maxLength={240} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} required />
          </label>}
          <label><Trans text={"Transaction reference (optional)"} /><input maxLength={120} value={transactionReference} onChange={(e) => setTransactionReference(e.target.value)} />
          </label>
          <small className="muted"><Trans text={"Any discount must comply with clinic admin billing rules. The original consultation remains unchanged."} /></small>
          <button type="submit" className="primary" disabled={busy}>{busy ? t("Processing...") : t("Confirm Payment & Issue Token")}</button>
          <button type="button" className="ghost" onClick={() => setSelected(null)}><Trans text={"Cancel"} /></button>
        </form>}
      </div>
    </div>
    <div className="referral-panel">
      <h3><Trans text={"Recent referrals"} /></h3>
      <div className="referral-list">
        {referrals.filter((r) => r.status !== "pending").slice(0, 12).map((r) => <article key={r._id} className="referral-entry">
          <div className="referral-entry-head"><strong>{r.patient?.name || t("Patient")}</strong><ReferralStatus status={r.status} /></div>
          <p>{r.fromDepartment} → {r.toDepartment} <Trans text={"· Dr. "} />{r.toDoctor?.name}</p>
          {r.targetToken && <small><Trans text={"Token #"} />{r.targetToken.tokenNumber} · {t(r.targetToken.status)}</small>}
        </article>)}
      </div>
    </div>
    {notice && <p className="referral-notice" role="status">{t(notice)}</p>}
  </details>;
}

export function PatientReferrals() {
  const { t } = useLanguage();
  const [referrals, setReferrals] = useState([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/referrals/patient/me");
      setReferrals(data.referrals || []); setError("");
    } catch (error) { setError(message(error)); }
  }, []);
  useEffect(() => {
    refresh();
    socket.on("patient:referrals-updated", refresh);
    socket.on("patient:token-updated", refresh);
    socket.on("connect", refresh);
    return () => {
      socket.off("patient:referrals-updated", refresh);
      socket.off("patient:token-updated", refresh);
      socket.off("connect", refresh);
    };
  }, [refresh]);
  return <details className="card referral-workspace">
    <summary><strong><Trans text={"My Department Referrals"} /></strong><span className="muted"><Trans text={"Specialist recommendations and destination tokens"} /></span></summary>
    {error && <p className="login-error" role="alert">{t(error)}</p>}
    {!referrals.length && <p className="muted"><Trans text={"No referrals recorded for this clinic."} /></p>}
    <div className="referral-list">{referrals.map((r) => <article key={r._id} className="referral-entry">
      <div className="referral-entry-head"><strong>{r.fromDepartment} → {r.toDepartment}</strong><ReferralStatus status={r.status} /></div>
      <p><Trans text={"Dr. "} />{r.fromDoctor?.name} <Trans text={"→ Dr. "} />{r.toDoctor?.name}</p>
      <p>{r.reason}</p>
      <small>{displayDate(r.createdAt)}</small>
      {r.targetToken ? <p><strong><Trans text={"New token #"} />{r.targetToken.tokenNumber}</strong> · {t(r.targetToken.status)}</p> : r.status === "pending" ? <p className="muted"><Trans text={"Please visit reception for destination check-in and fee confirmation."} /></p> : null}
    </article>)}</div>
  </details>;
}
