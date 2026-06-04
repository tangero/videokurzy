/**
 * Zálohový doklad (proforma) HTML generátor.
 *
 * ZD je interní doklad pro účetnictví firmy kupujícího — vystavuje se PŘED
 * platbou (jen u FIO převodu). Po přijetí platby Fakturoid vystaví finální
 * daňový doklad (fakturu) v PDF, ten je primární účetní dokument.
 *
 * Adaptováno z vibecoding-site (workshop ZD) na roční přístup ke kurzům.
 */

import {
  SUPPLIER,
  PROFORMA_PREFIX,
  bankDetails,
  type TransferBank,
} from "../config/payment";
import { generateSPD } from "./fio";
import { generateQRSvg } from "./qr";

export interface ProformaData {
  proformaNumber: string;
  issueDate: Date;
  dueDate: Date;
  // Odběratel
  companyName?: string | null;
  companyIco?: string | null;
  companyDic?: string | null;
  companyAddress?: string | null;
  companyCity?: string | null;
  companyZip?: string | null;
  contactName?: string | null;
  contactEmail: string;
  // Položka
  type: "individual" | "organization";
  domain?: string | null;
  amount: number;
  variableSymbol: string;
  // Banka pro bankovní spojení na dokladu (default fio kvůli starým objednávkám).
  bank?: TransferBank;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

function fmtAmount(n: number): string {
  return n.toLocaleString("cs-CZ");
}

function lineItemLabel(data: ProformaData): string {
  if (data.type === "organization") {
    const domain = data.domain ?? "";
    return `Roční přístup ke kurzům — firemní licence${domain ? ` (${domain})` : ""}`;
  }
  return "Roční přístup ke kurzům — osobní předplatné";
}

export function generateProformaHtml(data: ProformaData): string {
  const bank = bankDetails(data.bank ?? "fio");
  const spd = generateSPD(bank.iban, data.amount, data.variableSymbol, `Videokurz ${data.contactEmail}`);
  const qrSvg = generateQRSvg(spd);

  const buyerLines: string[] = [];
  if (data.companyName) buyerLines.push(`<p><strong>${esc(data.companyName)}</strong></p>`);
  if (data.companyAddress) buyerLines.push(`<p>${esc(data.companyAddress)}</p>`);
  if (data.companyZip || data.companyCity) {
    buyerLines.push(`<p>${esc(data.companyZip ?? "")} ${esc(data.companyCity ?? "")}</p>`);
  }
  if (data.companyIco) buyerLines.push(`<p>IČO: ${esc(data.companyIco)}</p>`);
  if (data.companyDic) buyerLines.push(`<p>DIČ: ${esc(data.companyDic)}</p>`);
  if (data.contactName) buyerLines.push(`<p><strong>${esc(data.contactName)}</strong></p>`);
  buyerLines.push(`<p>${esc(data.contactEmail)}</p>`);

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>Zálohový doklad ${esc(data.proformaNumber)}</title>
<style>
  body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; font-size: 14px; color: #222; max-width: 720px; margin: 0 auto; padding: 40px 24px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #666; margin: 0 0 32px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .box { padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; }
  .box h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; font-weight: 600; }
  .box p { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th { text-align: left; border-bottom: 2px solid #222; padding: 8px 12px; font-size: 13px; }
  td { padding: 12px; border-bottom: 1px solid #e0e0e0; }
  .total { font-size: 18px; font-weight: 700; text-align: right; margin: 20px 0; }
  .payment-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
  .payment-box p { margin: 4px 0; }
  .qr-section { text-align: center; margin: 24px 0; }
  .qr-section svg { width: 200px; height: 200px; }
  .note { color: #666; font-size: 12px; margin-top: 32px; border-top: 1px solid #e0e0e0; padding-top: 16px; }
  .actions { text-align: right; margin-top: 24px; }
  .actions button { padding: 8px 16px; border: 1px solid #999; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print { body { padding: 0; max-width: none; } .actions { display: none; } }
</style>
</head>
<body>
  <h1>Zálohový doklad ${esc(data.proformaNumber)}</h1>
  <p class="subtitle">Tento doklad není daňovým dokladem. Daňový doklad (faktura) bude vystaven po přijetí platby a zaslán emailem.</p>

  <div class="grid">
    <div class="box">
      <h3>Dodavatel</h3>
      <p><strong>${esc(SUPPLIER.name)}</strong></p>
      <p>${esc(SUPPLIER.address)}</p>
      <p>${esc(SUPPLIER.zip)} ${esc(SUPPLIER.city)}</p>
      <p>IČO: ${esc(SUPPLIER.ico)}</p>
      <p>${esc(SUPPLIER.email)}</p>
      <p style="color:#888;font-size:12px;margin-top:8px">Neplátce DPH.</p>
    </div>
    <div class="box">
      <h3>Odběratel</h3>
      ${buyerLines.join("\n      ")}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Položka</th>
        <th style="text-align:right">Částka</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(lineItemLabel(data))}</td>
        <td style="text-align:right">${fmtAmount(data.amount)} Kč</td>
      </tr>
    </tbody>
  </table>

  <p class="total">Celkem k úhradě: ${fmtAmount(data.amount)} Kč</p>

  <div class="payment-box">
    <p><strong>Platební údaje</strong></p>
    <p>Číslo účtu: ${esc(bank.account)} (${esc(bank.bankName)})</p>
    <p>IBAN: ${esc(bank.iban)}</p>
    <p>BIC/SWIFT: ${esc(bank.bic)}</p>
    <p>Variabilní symbol: <strong>${esc(data.variableSymbol)}</strong></p>
    <p>Částka: <strong>${fmtAmount(data.amount)} Kč</strong></p>
    <p>Datum vystavení: ${fmtDate(data.issueDate)}</p>
    <p>Splatnost: ${fmtDate(data.dueDate)}</p>
  </div>

  <div class="qr-section">
    <p><strong>QR platba</strong></p>
    ${qrSvg}
    <p style="font-size:11px;color:#888;margin-top:8px;">Naskenujte QR kód v mobilním bankovnictví.</p>
  </div>

  <div class="actions">
    <button type="button" onclick="window.print()">Vytisknout / uložit jako PDF</button>
  </div>

  <div class="note">
    <p>Platbu proveďte převodem na výše uvedený účet s uvedením variabilního symbolu.
    Po přijetí platby vám bude na e-mail ${esc(data.contactEmail)} zaslán daňový doklad (faktura).</p>
    <p>Platí <a href="https://kurzy.vibecoding.cz/obchodni-podminky">obchodní podmínky</a>.</p>
  </div>
</body>
</html>`;
}

/** ZD číslo: ZD-YYYY-NNN. Sekvence se inkrementuje v site_config per rok. */
export function formatProformaNumber(year: number, sequence: number): string {
  return `${PROFORMA_PREFIX}-${year}-${String(sequence).padStart(3, "0")}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
