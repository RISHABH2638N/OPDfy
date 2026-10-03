import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

export const subscriptionInvoiceNumber = id => `OPD-${String(id).toUpperCase()}`;
const fontPath = name => fileURLToPath(new URL(`../assets/invoice-fonts/${name}`, import.meta.url));
const date = value => value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "Not recorded";
const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
const methods = { upi: "UPI", cash: "Cash", card: "Card", bank_transfer: "Bank transfer", other: "Other" };

// Render from the saved ledger only. A download never creates a charge or payment.
export function subscriptionInvoicePdf(invoice, clinic, productName = "OPDfy") {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, font: fontPath("DejaVuSans.ttf"),
      info: { Title: `Subscription Invoice ${subscriptionInvoiceNumber(invoice._id)}`, Author: productName, CreationDate: new Date(invoice.createdAt) } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk)); doc.on("error", reject); doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.registerFont("regular", fontPath("DejaVuSans.ttf")); doc.registerFont("bold", fontPath("DejaVuSans-Bold.ttf"));
    doc.registerFont("hindi", fontPath("NotoSansDevanagari-Regular.woff"));
    const navy = "#163547", teal = "#087c80", muted = "#526c7a", line = "#dbe6ec";
    const clean = value => String(value || "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
    const text = (value, x, y, width, size = 10, color = navy, bold = false, align = "left") => {
      doc.fillColor(color).fontSize(size).font(bold ? "bold" : "regular");
      const runs = clean(value).match(/[\u0900-\u097f\u200c\u200d]+|[^\u0900-\u097f\u200c\u200d]+/gu) || [""];
      runs.forEach((run, index) => {
        doc.font(/[\u0900-\u097f]/u.test(run) ? "hindi" : bold ? "bold" : "regular");
        const options = { width, align, continued: index < runs.length - 1, lineGap: 3 };
        if (index === 0) doc.text(run, x, y, options); else doc.text(run, options);
      });
      return doc.y;
    };
    const rule = y => doc.moveTo(42, y).lineTo(553, y).strokeColor(line).lineWidth(.7).stroke();
    doc.rect(0, 0, 595.28, 9).fill(teal);
    let brandSize = 27;
    doc.font("bold");
    while (brandSize > 12 && doc.fontSize(brandSize).heightOfString(clean(productName), { width: 290, lineGap: 3 }) > 70) brandSize--;
    text(productName, 42, 39, 290, brandSize, navy, true);
    text("CLINIC EDITION  /  SOFTWARE SERVICES", 42, doc.y + 5, 300, 8, muted);
    const brandBottom = doc.y;
    text("INVOICE", 365, 42, 188, 24, navy, true, "right");
    text(invoice.status.toUpperCase(), 365, 81, 188, 10, invoice.status === "paid" ? teal : invoice.status === "void" ? "#a22c3a" : "#8b5516", true, "right");
    const top = Math.max(121, brandBottom + 16); rule(top);
    text("BILL TO", 42, top + 22, 285, 8, teal, true);
    let buyerY = text(clinic.legalVerification?.legalName || clinic.name, 42, top + 40, 285, 12, navy, true) + 5;
    for (const field of [clinic.settings?.branding?.address, clinic.contactEmail, clinic.contactPhone]) {
      if (field) buyerY = text(field, 42, buyerY, 285, 9, muted) + 5;
    }
    text("INVOICE NUMBER", 350, top + 22, 203, 8, muted, true);
    text(subscriptionInvoiceNumber(invoice._id), 350, top + 39, 203, 8, navy, true);
    text(`Issued: ${date(invoice.createdAt)}`, 350, top + 65, 203, 9, muted);
    text(`Due: ${date(`${invoice.dueDate}T00:00:00+05:30`)}`, 350, top + 85, 203, 9, muted);
    let tableY = Math.max(buyerY + 26, top + 132);
    if (tableY > 345) {
      doc.addPage(); text("SUBSCRIPTION INVOICE - CONTINUED", 42, 45, 511, 12, navy, true);
      text(subscriptionInvoiceNumber(invoice._id), 42, 69, 511, 9, muted); tableY = 104;
    }
    doc.roundedRect(42, tableY, 511, 31, 5).fill("#edf7f6");
    text("DESCRIPTION", 55, tableY + 10, 310, 8, teal, true);
    text("QTY", 380, tableY + 10, 35, 8, teal, true, "center");
    text("AMOUNT (INR)", 425, tableY + 10, 114, 8, teal, true, "right");
    const service = invoice.billingCycle === "setup" ? "Clinic setup and onboarding" : `${invoice.billingCycle === "yearly" ? "Annual" : "Monthly"} clinic subscription`;
    text(service, 55, tableY + 50, 310, 11, navy, true);
    text(`Plan: ${invoice.plan}`, 55, tableY + 72, 310, 9, muted);
    text("1", 380, tableY + 51, 35, 10, navy, false, "center");
    text(money(invoice.amountPaise), 425, tableY + 51, 114, 10, navy, true, "right");
    rule(tableY + 106);
    const totalY = tableY + 124;
    text("Invoice total", 345, totalY, 105, 10, navy, true);
    text(money(invoice.amountPaise), 450, totalY, 103, 14, teal, true, "right");
    text("Recorded payment", 345, totalY + 33, 115, 9, muted);
    text(money(invoice.status === "paid" ? invoice.amountPaise : 0), 460, totalY + 33, 93, 10, navy, false, "right");
    text("Balance due", 345, totalY + 57, 115, 9, muted);
    text(money(invoice.status === "pending" ? invoice.amountPaise : 0), 460, totalY + 57, 93, 10, navy, true, "right");
    const paymentY = totalY + 104;
    doc.roundedRect(42, paymentY, 511, 87, 8).fill("#f6f9fb");
    text("PAYMENT DETAILS", 56, paymentY + 14, 480, 8, teal, true);
    text(`Status: ${invoice.status === "paid" ? "Paid - payment recorded" : invoice.status === "void" ? "Void - cancelled, no amount due" : "Pending - payment not recorded"}`, 56, paymentY + 34, 480, 9);
    text(`Method: ${methods[invoice.method] || "Not recorded"}     |     Payment date: ${date(invoice.paidAt)}`, 56, paymentY + 57, 480, 9, muted);
    text("This document reflects the saved subscription ledger. Recording a payment does not automatically renew clinic access.", 42, paymentY + 108, 511, 9, muted);
    text("Tax details are not configured. This is not a GST tax invoice.", 42, doc.y + 12, 511, 9, muted);
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index++) {
      doc.switchToPage(index); rule(757);
      text("Generated by OPDfy  /  Subscription billing", 42, 771, 390, 8, muted);
      text(`${index + 1} / ${pages.count}`, 492, 771, 61, 8, muted, false, "right");
    }
    doc.end();
  });
}
