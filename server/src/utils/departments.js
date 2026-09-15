export const DEPARTMENTS = [
  "General OPD",
  "Cardiology",
  "Orthopedics",
  "Neurology",
  "ENT",
  "Pediatrics",
  "Dermatology",
];

const ALIASES = new Map([
  ["general opd", "General OPD"],
  ["general medicine", "General OPD"],
  ["cardiology", "Cardiology"],
  ["orthopedic", "Orthopedics"],
  ["orthopedics", "Orthopedics"],
  ["orthopaedic", "Orthopedics"],
  ["orthopaedics", "Orthopedics"],
  ["neurology", "Neurology"],
  ["neurologist", "Neurology"],
  ["ent", "ENT"],
  ["pediatrics", "Pediatrics"],
  ["paediatrics", "Pediatrics"],
  ["dermatology", "Dermatology"],
  ["dermatologist", "Dermatology"],
  ["skin", "Dermatology"],
]);

export function normalizeDepartment(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES.get(key) || String(value || "").trim();
}

export function isValidDepartment(value) {
  return DEPARTMENTS.includes(normalizeDepartment(value));
}
