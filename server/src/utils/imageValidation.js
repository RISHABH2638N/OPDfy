const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

function matchesMagic(type, bytes) {
  if (type === "png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (type === "jpeg" || type === "jpg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "webp") return bytes.length >= 12 && bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP";
  return false;
}

export function validateImageDataUrl(value, { maxBytes = 160000 } = {}) {
  const text = String(value || "").trim();
  if (!text) return { ok: true, bytes: 0 };
  const match = text.match(DATA_IMAGE);
  if (!match) return { ok: false, message: "Image must be a PNG, JPG, or WebP upload." };
  let bytes;
  try { bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64"); } catch { return { ok: false, message: "Image data is malformed." }; }
  if (!bytes.length || bytes.length > maxBytes) return { ok: false, message: `Image must be smaller than ${Math.floor(maxBytes/1024)} KB.` };
  if (!matchesMagic(match[1].toLowerCase(), bytes)) return { ok: false, message: "Image content does not match its declared file type." };
  return { ok: true, bytes: bytes.length };
}

export function externalAssetUrlAllowed(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return false;
  if (process.env.NODE_ENV !== "production") return true;
  const allow = String(process.env.CLINIC_ASSET_ALLOWED_HOSTS || "")
    .split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!allow.length) return false;
  try { const url = new URL(text); return url.protocol === "https:" && !url.username && !url.password && allow.includes(url.hostname.toLowerCase()); } catch { return false; }
}
