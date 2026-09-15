import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "./api";
import { useLanguage, Trans } from "./LanguageContext";
import "./privacy-center.css";

const msg = (error) => error.response?.data?.message || "Request failed.";

export default function PrivacyPhase3Clinic() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [tab, setTab] = useState("guardians");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const { data } = await api.get(`/privacy-clinic/${tab}`);
    setRows(data.cases || data.requests || data.policies || []);
  };

  useEffect(() => {
    setSelected(null);
    load().catch((loadError) => setError(msg(loadError)));
  }, [tab]);

  const open = async (item) => {
    setError("");
    try {
      if (tab === "corrections") {
        const { data } = await api.get(`/privacy-clinic/corrections/${item.id}`);
        setSelected(data.request);
      } else setSelected(item);
      setDraft({});
    } catch (openError) {
      setError(msg(openError));
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const requestPath = tab === "guardians"
        ? `/privacy-clinic/guardians/${selected.id}/review`
        : `/privacy-clinic/corrections/${selected.id}/resolve`;
      const { data } = await api.post(requestPath, draft);
      setMessage(data.message); setSelected(null); setDraft({});
      await load();
    } catch (submitError) {
      setError(msg(submitError));
    } finally {
      setBusy(false);
    }
  };

  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const tabs = [["guardians", "Guardian cases"], ["corrections", "Corrections"], ["retention", "Approved retention policies"]];

  return <main className="page premium-page privacy-center">
    <div className="head">
      <div>
        <p className="eyebrow"><Trans text="CLINIC · PRIVACY" /></p>
        <h1><Trans text="Identity & correction review" /></h1>
        <p className="page-subtitle"><Trans text="Review only positively verified memberships belonging to your clinic." /></p>
      </div>
      <button className="ghost" onClick={() => navigate("/admin")}><ArrowLeft size={16}/> <Trans text="Back to admin" /></button>
    </div>

    <section className="card">
      <div className="privacy-actions" style={{ justifyContent: "flex-start" }}>
        {tabs.map(([value, label]) => <button type="button" key={value} className={tab === value ? "primary" : "ghost"} onClick={() => setTab(value)}>{t(label)}</button>)}
        <button className="ghost" onClick={() => load().catch((loadError) => setError(msg(loadError)))}><RefreshCw size={15}/> <Trans text="Refresh" /></button>
      </div>
      <p className="muted"><Trans text="Guardian email verification alone is not proof of legal authority. A clinic review does not grant access to clinical records or external AI. Correction reviews record evidence; clinical changes must be performed through existing authorized workflows." /></p>

      <div className="privacy-history">
        {rows.map((item) => <article className="privacy-request" key={item.id || item._id}>
          <strong>{tab === "guardians" ? item.guardianName : tab === "corrections" ? item.field : item.category}</strong>
          <p>{tab === "guardians" ? `${item.guardianEmail} · ${item.relationship}` : tab === "corrections" ? item.details : `${item.version} · ${item.retentionRule}`}</p>
          {tab === "retention" ? <p className="muted">{item.legalBasis}</p> : <button type="button" className="ghost" onClick={() => open(item)}><Trans text="Review" /></button>}
        </article>)}
      </div>
      {!rows.length && <p className="muted"><Trans text="No records found." /></p>}

      {selected && <form className="privacy-form" onSubmit={submit}>
        <h3>{t(tab === "guardians" ? "Review guardian authority" : "Review correction")}</h3>
        {tab === "corrections" && <>
          <p><Trans text="Field:" /> {selected.correction?.field} · <Trans text="Record:" /> {selected.correction?.recordId}</p>
          <p><Trans text="Requested value:" /> {selected.correction?.proposedValue}</p>
          <p>{selected.correction?.reason}</p>
        </>}
        <label><Trans text="Decision" /><select required value={draft.decision || ""} onChange={(event) => change("decision", event.target.value)}>
          <option value=""><Trans text="Choose..." /></option>
          {tab === "guardians" ? <>
            <option value="verified"><Trans text="Authority verified" /></option>
            <option value="rejected"><Trans text="Reject" /></option>
          </> : <>
            <option value="corrected"><Trans text="Correction completed in authorized record" /></option>
            <option value="no_change"><Trans text="No change required" /></option>
            <option value="rejected"><Trans text="Reject" /></option>
          </>}
        </select></label>
        <label><Trans text="Evidence reference" /><input required minLength={5} maxLength={240} value={draft.evidenceReference || ""} onChange={(event) => change("evidenceReference", event.target.value)}/></label>
        <label><Trans text="Documented review note" /><textarea required minLength={20} maxLength={tab === "guardians" ? 1200 : 2000} rows={3} value={(draft.reviewNote ?? draft.resolution) || ""} onChange={(event) => change(tab === "guardians" ? "reviewNote" : "resolution", event.target.value)}/></label>
        <div className="privacy-actions">
          <button type="button" className="ghost" onClick={() => setSelected(null)}><Trans text="Cancel" /></button>
          <button className="primary" disabled={busy || !draft.decision}><ShieldCheck size={15}/><Trans text="Save documented review" /></button>
        </div>
      </form>}

      {error && <p className="login-error" role="alert">{t(error)}</p>}
      {message && <p className="success" role="status">{t(message)}</p>}
    </section>
  </main>;
}
