import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { translateUiText, setUiLanguage, localizeUi, translationCatalog } from "../src/i18n.js";
import { formatActivitySummary, formatActivityModule, formatActivityAction } from "../src/activityI18n.js";

const hi = (text, params) => translateUiText(text, "hi", params);

test("Requested reception and clinic text is translated", () => {
  assert.equal(hi("Choose your clinic"), "अपना क्लिनिक चुनें");
  assert.equal(hi("Recent Activity"), "हाल की गतिविधि");
  assert.match(hi("Manage arrivals, patient registration, queue interventions, appointments and prescription handover from one workspace."), /रोगियों का आगमन/);
  assert.match(hi("Your login works across OPDfy clinics. Medical records remain isolated inside the clinic where care was delivered."), /मेडिकल रिकॉर्ड/);
  assert.equal(hi("Welcome, Rishabh Mishra"), "स्वागत है, Rishabh Mishra");
});

test("Platform privacy navigation and governance labels are translated", () => {
  assert.equal(hi("Privacy Requests"), "गोपनीयता अनुरोध");
  assert.equal(hi("Retention registry"), "डेटा संरक्षण अवधि रजिस्टर");
  assert.equal(hi("Incident register"), "घटना रजिस्टर");
  assert.equal(hi("Global corrections"), "वैश्विक प्रोफ़ाइल सुधार");
  assert.equal(hi("Operational readiness & notification evidence"), "संचालन तैयारी और सूचना प्रमाण");
  assert.equal(hi("Interface language"), "इंटरफ़ेस भाषा");
  assert.equal(hi("Review checks"), "समीक्षा जाँचें");
  assert.equal(hi("Incident notifications"), "घटना सूचनाएँ");
  assert.equal(hi("Evidence checklist"), "प्रमाण जाँच सूची");
});

test("Clinical content, names, identifiers and token numbers remain intact", () => {
  assert.equal(hi("Patient has left-sided weakness and MRI findings."), "Patient has left-sided weakness and MRI findings.");
  assert.equal(hi("Nitin somani"), "Nitin somani");
  assert.equal(hi("Token #123"), "टोकन #123");
  assert.equal(hi("6aa01785e4603a40c810e040"), "6aa01785e4603a40c810e040");
  assert.equal(hi("patient@example.com"), "patient@example.com");
});

test("Language switch and parameterized messages preserve their values", () => {
  setUiLanguage("hi");
  assert.equal(localizeUi("Please enter a valid email address."), "कृपया सही ईमेल पता दर्ज करें।");
  const message = "Appointment confirmed with Dr. {doctor} on {date} at {time}.";
  assert.equal(hi(message, {doctor:"Nitin",date:"2026-09-08",time:"10:00"}),
    "डॉ. Nitin के साथ 2026-09-08 को 10:00 बजे अपॉइंटमेंट की पुष्टि हो गई।");
  setUiLanguage("en");
  assert.equal(localizeUi(message,{doctor:"Nitin",date:"2026-09-08",time:"10:00"}),
    "Appointment confirmed with Dr. Nitin on 2026-09-08 at 10:00.");
});

test("Historic audit summaries translate without altering forensic details", () => {
  const ref = "6aa01785e4603a40c810e040";
  const log = {action:"RECEPTION_REFERRAL_ACCEPTED",module:"Referral",
    summary:`Referral ${ref} accepted; target token #1 in Orthopedics.`};
  assert.equal(formatActivitySummary(log,"hi"),
    `रेफरल ${ref} स्वीकार किया गया; हड्डी रोग विभाग में नया टोकन #1 जारी हुआ।`);
  assert.equal(formatActivitySummary({summary:"Completed POST operation in auth"},"hi"),
    "प्रमाणीकरण में POST अनुरोध पूरा हुआ");
  assert.equal(formatActivitySummary({summary:"Completed a consultation",action:"COMPLETE_CONSULTATION"},"hi"),
    "परामर्श पूर्ण किया गया");
  assert.equal(formatActivityModule("auth","hi"),"प्रमाणीकरण");
  assert.equal(formatActivityAction("COMPLETE_CONSULTATION","hi"),"परामर्श पूर्ण किया गया");
  const unknown = {action:"UPDATE_TOKEN_STATUS",summary:"Custom operational detail 42"};
  assert.match(formatActivitySummary(unknown,"hi"), /Custom operational detail 42/);
  assert.equal(formatActivitySummary(log,"en"),log.summary);
});

test("Every original visible copy string has a catalogue entry", () => {
  const inventory = JSON.parse(readFileSync(new URL("./localization-inventory.json",import.meta.url),"utf8"));
  const missing = inventory.filter(value => !(value in translationCatalog));
  assert.deepEqual(missing,[]);
  assert.ok(Object.keys(translationCatalog).length >= 1000);
});

test("React owns translations; no DOM rewriting or network translation", () => {
  const source = readFileSync(new URL("../src/LanguageContext.jsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/MutationObserver|createTreeWalker|nodeValue\s*=/);
  assert.match(source,/export function useLanguage/);
  assert.match(source,/opd_ui_language/);
  const core = readFileSync(new URL("../src/i18n.js",import.meta.url),"utf8");
  assert.doesNotMatch(core,/\bfetch\s*\(|XMLHttpRequest|eval\s*\(/);
});

test("Public header keeps patient access visible and moves secondary actions into an accessible compact drawer", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/public-responsive-navigation.css", import.meta.url), "utf8");
  assert.match(app, /className="patient-portal-link"/);
  assert.match(app, /className="public-menu-toggle"/);
  assert.match(app, /id="public-mobile-navigation"/);
  assert.match(app, /role="dialog" aria-modal="true"/);
  assert.match(app, /<LanguageSwitcher\s*\/>/);
  assert.match(app, /<ThemeToggle\s*\/>/);
  assert.match(app, /Register Clinic/);
  assert.match(app, /Platform Admin/);
  assert.match(app, /Staff Sign In/);
  assert.match(css, /@media\(max-width:1120px\)/);
  assert.match(css, /\.public-desktop-actions\{display:none!important\}/);
  assert.match(css, /\.public-mode \.public-menu-toggle\{display:grid/);
  assert.equal(hi("Menu & preferences"), "मेनू और प्राथमिकताएँ");
  assert.equal(hi("Access your clinic workstation"), "अपना क्लिनिक कार्यस्थल खोलें");
});
