import express from "express";

// Express 4 does not forward rejected async handlers to its error middleware.
export function asyncRouter() {
  const router = express.Router();
  const wrap = (handler) => Array.isArray(handler) ? handler.map(wrap) :
    typeof handler !== "function" || handler.length === 4 ? handler :
      (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  for (const method of ["get", "post", "put", "patch", "delete", "use"]) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrap));
  }
  return router;
}

export function publicErrorMessage(error, fallback = "Unable to complete request.") {
  const status = Number(error?.status || error?.statusCode);
  return status >= 400 && status < 500 && !["CastError", "ValidationError"].includes(error?.name)
    ? error.message || fallback : fallback;
}

export function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Spreadsheet apps execute formulas even inside correctly quoted CSV cells.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
