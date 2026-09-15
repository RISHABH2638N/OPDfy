import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicyAcceptance, POLICY_VERSION } from '../src/utils/policyAcceptance.js';
import Tenant from '../src/models/Tenant.js';
import { POLICY_VERSION as displayedVersion } from '../../client/src/publicContent.js';

test('new clinic acceptance rejects missing, unchecked, stale and coerced requests',()=>{
  for(const input of [undefined,null,{}, {accepted:false,version:POLICY_VERSION,language:'en'}, {accepted:'true',version:POLICY_VERSION,language:'en'}, {accepted:true,version:'old',language:'hi'}, {accepted:true,version:POLICY_VERSION,language:'xx'}]) assert.ok(validatePolicyAcceptance(input).error);
});
test('acceptance records server time and the versions displayed to the user',()=>{
  assert.equal(POLICY_VERSION,displayedVersion);
  for (const language of ['en','hi']) {
    const start=Date.now();
    const {value,error}=validatePolicyAcceptance({accepted:true,version:POLICY_VERSION,language,acceptedAt:'2000-01-01'});
    assert.equal(error,undefined);
    assert.equal(value.termsVersion,POLICY_VERSION); assert.equal(value.privacyVersion,POLICY_VERSION);
    assert.equal(value.language,language); assert.ok(value.acceptedAt.getTime()>=start);
    const tenant=new Tenant({name:'Fixture Clinic',slug:'fixture-clinic',onboarding:{policyAcceptance:value}});
    assert.equal(tenant.validateSync(),undefined);
    assert.equal(tenant.toObject().onboarding.policyAcceptance.language,language);
  }
});
test('existing tenants remain valid without a policy acceptance record',()=>{
  const tenant=new Tenant({name:'Existing Clinic',slug:'existing-clinic'});
  assert.equal(tenant.validateSync(),undefined);
  assert.equal(tenant.onboarding.policyAcceptance,undefined);
});
