const forbidden = new Set(["__proto__", "prototype", "constructor"]);

export function validateInputTree(value, depth = 0, field = "") {
  if (depth > 12) throw new Error("Request data is too deeply nested.");
  if (typeof value === "string") {
    const maximum = field === "logoUrl" ? 450000 : field === "signatureDataUrl" ? 350000 : 16000;
    if (value.length > maximum) throw new Error("A request field is too long.");
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error("Too many items in a request field.");
    value.forEach((item) => validateInputTree(item, depth + 1, field));
  } else if (value && typeof value === "object") {
    if (Object.keys(value).length > 200) throw new Error("Too many request fields.");
    for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key) || key.startsWith("$") || key.includes(".")) {
        throw new Error("Unsupported request field.");
      }
      validateInputTree(item, depth + 1, key);
    }
  }
}

export function requestSafety(req, res, next) {
  res.set("Cache-Control", "no-store");
  try {
    validateInputTree(req.query);
    validateInputTree(req.body);
    if (req.body != null && (typeof req.body !== "object" || Array.isArray(req.body))) {
      throw new Error("Request body must be a JSON object.");
    }
    for (const key of ["email", "password", "clinicSlug", "otp", "adminEmail", "contactEmail"]) {
      if (req.body?.[key] !== undefined && typeof req.body[key] !== "string") {
        throw new Error("Invalid authentication field.");
      }
    }
    if (req.body?.password && Buffer.byteLength(req.body.password, "utf8") > 72) {
      throw new Error("Password must be at most 72 UTF-8 bytes.");
    }
    if (Object.values(req.query || {}).some((v) => typeof v !== "string")) {
      throw new Error("Query parameters must be single text values.");
    }
    next();
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}
