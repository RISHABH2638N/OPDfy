import { currentTenantId } from "../services/tenantExecutionContext.js";

const QUERY_OPS = [
  "find", "findOne", "countDocuments", "distinct",
  "updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove",
  "replaceOne"
];

function requireTenant() {
  const tenantId = currentTenantId();
  if (!tenantId) {
    const error = new Error("Tenant execution context is required for tenant-owned data.");
    error.code = "TENANT_CONTEXT_REQUIRED";
    throw error;
  }
  return tenantId;
}

export default function tenantScopedPlugin(schema) {
  schema.path("tenantId").immutable(true);
  schema.pre("estimatedDocumentCount", function () { throw new Error("Use tenant-scoped countDocuments instead."); });
  schema.pre("bulkWrite", function () { throw new Error("Tenant bulkWrite is disabled; use scoped model operations."); });
  schema.pre("validate", function () {
    const tenantId = requireTenant();
    if (this.tenantId && String(this.tenantId) !== tenantId) throw new Error("Cross-tenant document write blocked.");
    this.tenantId = tenantId;
  });
  for (const op of QUERY_OPS) {
    schema.pre(op, function tenantQueryScope() {
      const tenantId = requireTenant();
      this.where({ tenantId });
      if (op === "updateOne" || op === "updateMany" || op.startsWith("findOneAnd") || op === "replaceOne") {
        const update = this.getUpdate?.() || {};
        if (Array.isArray(update)) throw new Error("Tenant update pipelines are disabled.");
        for (const [operator, value] of Object.entries(update)) {
          if (!operator.startsWith("$") || !value || typeof value !== "object") continue;
          for (const [path, target] of Object.entries(value)) {
            if ((path === "tenantId" || path.startsWith("tenantId.")) && !(operator === "$setOnInsert" && String(target) === tenantId)) {
              throw new Error("Tenant ownership is immutable.");
            }
            if (operator === "$rename" && (target === "tenantId" || String(target).startsWith("tenantId."))) throw new Error("Tenant ownership is immutable.");
          }
        }
        if (op === "replaceOne" || op === "findOneAndReplace") update.tenantId = tenantId;
        if (update.tenantId && String(update.tenantId) !== tenantId) {
          throw Object.assign(new Error("Cross-tenant ownership changes are forbidden."), { code: "TENANT_MISMATCH" });
        }
        if (update.$set?.tenantId && String(update.$set.tenantId) !== tenantId) {
          throw Object.assign(new Error("Cross-tenant ownership changes are forbidden."), { code: "TENANT_MISMATCH" });
        }
      }
    });
  }

  schema.pre("aggregate", function tenantAggregateScope() {
    const tenantId = requireTenant();
    if (this.pipeline().some((stage) => ["$lookup", "$unionWith", "$graphLookup", "$out", "$merge"].some((key) => key in stage))) throw new Error("Cross-collection aggregation requires an explicitly scoped service.");
    this.pipeline().unshift({ $match: { tenantId: this.model().base.Types.ObjectId.createFromHexString(tenantId) } });
  });

  schema.pre("save", function tenantSaveScope() {
    const tenantId = requireTenant();
    if (this.tenantId && String(this.tenantId) !== tenantId) {
      throw Object.assign(new Error("Cross-tenant document write blocked."), { code: "TENANT_MISMATCH" });
    }
    this.tenantId = tenantId;
  });

  schema.pre("insertMany", function tenantInsertManyScope(next, docs) {
    try {
      const tenantId = requireTenant();
      for (const doc of docs || []) {
        if (doc.tenantId && String(doc.tenantId) !== tenantId) {
          throw Object.assign(new Error("Cross-tenant bulk write blocked."), { code: "TENANT_MISMATCH" });
        }
        doc.tenantId = tenantId;
      }
      next();
    } catch (error) { next(error); }
  });
}
