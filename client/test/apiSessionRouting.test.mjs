import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

async function createHarness() {
  const store = new Map();
  const events = [];
  const socketHandlers = new Map();
  const socket = {
    auth: {}, connected: false,
    connect() { this.connected = true; },
    disconnect() { this.connected = false; },
    emit() {},
    on(name, fn) { socketHandlers.set(name, fn); },
  };
  const clients = [];
  const sent = [];
  function createClient() {
    const client = {
      defaults: {},
      interceptors: {
        request: { handlers: [], use(fn, reject) { this.handlers.push({fn,reject}); } },
        response: { handlers: [], use(fn, reject) { this.handlers.push({fn,reject}); } },
      },
      post: async (url, data, config = {}) => {
        await Promise.resolve();
        let request = { url, data, headers: {}, ...config };
        for (const handler of client.interceptors.request.handlers) request = await handler.fn(request);
        sent.push(request);
        return {data:{}};
      },
    };
    clients.push(client);
    return client;
  }
  const storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key,value) => store.set(key,String(value)),
    removeItem: key => store.delete(key),
  };
  const context = vm.createContext({
    console, sessionStorage:storage, CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},
    window:{location:{hostname:"localhost"},dispatchEvent:event=>events.push(event)},
  });
  const main = new vm.SourceTextModule(readFileSync(new URL("../src/api.js",import.meta.url),"utf8"),{
    context,identifier:"api.js",initializeImportMeta(meta){meta.env={PROD:false,DEV:true,VITE_API_URL:"",VITE_SOCKET_URL:"",VITE_CLINIC_SLUG:""};},
  });
  const routing = new vm.SourceTextModule(readFileSync(new URL("../src/authRouting.js",import.meta.url),"utf8"),{context,identifier:"authRouting.js"});
  const axios = new vm.SyntheticModule(["default"],function(){this.setExport("default",{create:createClient});},{context,identifier:"axios"});
  const socketModule = new vm.SyntheticModule(["socket"],function(){this.setExport("socket",socket);},{context,identifier:"socket"});
  await main.link(specifier=>({axios,"./socket":socketModule,"./authRouting.js":routing})[specifier]);
  await main.evaluate();
  return {api:main.namespace, clients,store,events,socket,socketHandlers,sent};
}
const request = (client,url) => client.interceptors.request.handlers[0].fn({url,headers:{}});
const reject = async (client,status,config) => {
  const error={response:{status},config};
  await assert.rejects(client.interceptors.response.handlers[0].reject(error),e=>e===error);
};

test("real Axios interceptors route patient referrals without staff credentials",async()=>{
  const h=await createHarness();
  const [api,platform,patient]=[h.api.api,h.api.platformApi,h.api.patientPlatformApi];
  h.store.set("opd_patient_token","patient-1");
  h.store.set("opd_token","staff-1");
  h.store.set("opd_platform_token","platform-1");
  h.store.set("opd_active_clinic_slug","mishra-clinic");
  assert.equal(request(api,"/referrals/patient/me").headers.Authorization,"Bearer patient-1");
  assert.equal(request(api,"/patients/me").headers.Authorization,"Bearer patient-1");
  assert.equal(request(api,"/referrals/doctors").headers.Authorization,"Bearer staff-1");
  assert.equal(request(api,"/referrals/123/quote").headers.Authorization,"Bearer staff-1");
  assert.equal(request(patient,"/patient-auth/me").headers.Authorization,"Bearer patient-1");
  assert.equal(request(platform,"/platform/overview").headers.Authorization,"Bearer platform-1");
  h.store.delete("opd_patient_token");
  assert.equal(request(api,"/referrals/patient/me").headers.Authorization,undefined);
  assert.equal(request(api,"/referrals/doctors").headers.Authorization,"Bearer staff-1");
});

test("a genuine patient 401 expires only the patient session",async()=>{
  const h=await createHarness();
  h.store.set("opd_patient_token","patient-1");
  h.store.set("opd_patient_user",'{"name":"Patient"}');
  h.store.set("opd_token","staff-1");
  h.store.set("opd_user",'{"name":"Doctor"}');
  h.store.set("opd_active_clinic_slug","mishra-clinic");
  const config=request(h.api.api,"/referrals/patient/me");
  await reject(h.api.api,401,config);
  assert.equal(h.store.has("opd_patient_token"),false);
  assert.equal(h.store.get("opd_token"),"staff-1");
  assert.equal(h.store.get("opd_user"),'{"name":"Doctor"}');
  assert.equal(h.events.filter(e=>e.type==="opd:session-expired").length,1);
  assert.equal(h.events.at(-1).detail.kind,"patient");
});

test("old requests, public authentication, 403 and 500 cannot log out the patient",async()=>{
  const h=await createHarness();
  h.store.set("opd_patient_token","patient-2");
  h.store.set("opd_token","staff-1");
  await reject(h.api.api,401,{url:"/referrals/patient/me",headers:{Authorization:"Bearer patient-1"}});
  await reject(h.api.api,403,request(h.api.api,"/referrals/patient/me"));
  await reject(h.api.api,500,request(h.api.api,"/referrals/patient/me"));
  await reject(h.api.patientPlatformApi,401,request(h.api.patientPlatformApi,"/patient-auth/verify-otp"));
  assert.equal(h.store.get("opd_patient_token"),"patient-2");
  assert.equal(h.store.get("opd_token"),"staff-1");
  assert.equal(h.events.filter(e=>e.type==="opd:session-expired").length,0);
});

for (const [kind, key, method, endpoint] of [
  ["staff", "opd_token", "logout", "/auth/logout"],
  ["patient", "opd_patient_token", "logoutPatient", "/patient-auth/logout"],
  ["platform", "opd_platform_token", "logoutPlatform", "/platform/auth/logout"],
]) {
  test(`${kind} logout revokes the old credential after storage clearing and immediate re-login`, async () => {
    const h = await createHarness();
    h.store.set(key, "old-session");
    h.store.set("opd_active_clinic_slug", "clinic-a");
    h.api[method]();
    assert.equal(h.store.has(key), false);
    h.store.set(key, "new-session");
    h.store.set("opd_active_clinic_slug", "clinic-b");
    await new Promise(resolve => setImmediate(resolve));
    const req = h.sent.find(req => req.url === endpoint);
    assert.ok(req);
    assert.equal(req.headers.Authorization, "Bearer old-session");
    if (kind === "staff") assert.equal(req.headers["X-Clinic-Slug"], "clinic-a");
    assert.equal(h.store.get(key), "new-session");
  });
}
