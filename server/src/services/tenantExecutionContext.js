import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function runWithTenant(tenantId, callback) {
  if (!tenantId) throw new Error("Tenant context is required.");
  // Execute lazy Mongoose thenables before leaving the AsyncLocalStorage scope.
  return storage.run({ tenantId: String(tenantId) }, async () => await callback());
}

export function currentTenantId() {
  return storage.getStore()?.tenantId || null;
}
