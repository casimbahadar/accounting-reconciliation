/* CORE-START: pure functions, no page access. Tests call these through window.Recon. */
const Recon = (() => {
  const HST_RATE = 13;

  function detectDelimiter(text) {
    let line = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      else if (!q && (c === "\n" || c === "\r")) break;
      line += q ? "" : c;
    }
    const counts = { ",": 0, ";": 0, "\t": 0 };
    for (const c of line) if (c in counts) counts[c]++;
    let best = ",";
    for (const d of [";", "\t"]) if (counts[d] > counts[best]) best = d;
    return best;
  }

  function parseCSV(text, label) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const delim = detectDelimiter(text);
    const records = [];
    let field = "", fields = [], inQuotes = false, line = 1, quoteLine = 0;
    const end = () => { fields.push(field); field = ""; records.push(fields); fields = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else { if (c === "\n") line++; field += c; }
        continue;
      }
      if (c === '"' && field === "") { inQuotes = true; quoteLine = line; }
      else if (c === delim) { fields.push(field); field = ""; }
      else if (c === "\r") { if (text[i + 1] === "\n") i++; end(); line++; }
      else if (c === "\n") { end(); line++; }
      else field += c;
    }
    if (inQuotes) throw new Error("In the " + label + ", line " + quoteLine + " opens a quote that never closes. Check that line for a stray \" character.");
    if (field !== "" || fields.length) end();
    const rows = [];
    records.forEach((f, i) => { if (f.some(v => v.trim() !== "")) rows.push({ row: i + 1, cells: f.map(v => v.trim()) }); });
    if (!rows.length) throw new Error("The " + label + " is empty.");
    const width = Math.max(...rows.map(r => r.cells.length));
    // A data row has a date and an amount in it. Some bank exports have no header row at all,
    // and some report exports put title lines above the header.
    const isData = r => { const cs = r.cells.filter(v => v !== ""); return cs.some(v => dateParts(v)) && cs.some(v => !dateParts(v) && /\d/.test(v) && parseMoney(v) !== null); };
    let hi = 0, noHeader = false;
    if (isData(rows[0])) noHeader = true;
    else {
      const need = Math.max(2, Math.ceil(width * 0.5));
      const found = rows.slice(0, 10).findIndex(r => r.cells.filter(v => v !== "").length >= need && !isData(r));
      hi = found < 0 ? 0 : found;
    }
    const headers = [];
    for (let i = 0; i < width; i++) headers.push(noHeader ? "Column " + (i + 1) : (rows[hi].cells[i] || "Column " + (i + 1)));
    const bodyRaw = noHeader ? rows : rows.slice(hi + 1);
    if (!bodyRaw.length) throw new Error("The " + label + " has a header row but no data rows.");
    const totalRows = [], body = [];
    for (const r of bodyRaw) {
      const c = r.cells.slice(); while (c.length < width) c.push("");
      if (c.some(v => /^(grand )?totals?\b/i.test(v))) totalRows.push(r.row); else body.push({ row: r.row, cells: c });
    }
    return { headers, rows: body, delimiter: delim, noHeader, titleRows: noHeader ? 0 : hi, totalRows };
  }

  const ROLES = {
    inv: [
      ["number", "Invoice number", true], ["customer", "Customer", false], ["date", "Invoice date", true],
      ["subtotal", "Subtotal before tax", false], ["code", "Tax code", false], ["tax", "Tax", false], ["total", "Total", true]
    ],
    bank: [
      ["date", "Date", true], ["desc", "Description", true], ["desc2", "More description", false], ["amount", "Amount (one column, deposits positive)", false],
      ["deposit", "Deposit column", false], ["withdrawal", "Withdrawal column", false]
    ]
  };
  const PATTERNS = {
    inv: [
      ["date", /^(?!.*due).*date/i], ["code", /tax ?(code|type|class)|^code$/i], ["subtotal", /sub ?-?total|before tax|pre-?tax|net amount|^net$/i],
      ["tax", /^(tax|hst|gst|sales tax|tax amount|hst amount|tps|tvh)$/i], ["total", /total|amount due|gross|^amount$|montant/i],
      ["customer", /customer|client|bill ?to|source name|name/i], ["number", /invoice|inv\b|number|^num$|no\.?$|#|facture/i]
    ],
    bank: [
      ["date", /date|posted/i], ["deposit", /deposit|credit|money in|paid in|d[ée]p[oô]t/i], ["withdrawal", /withdraw|debit|money out|paid out|retrait/i],
      ["amount", /amount|value|montant|cad ?\$/i], ["desc", /desc|detail|memo|payee|transaction|narrative|name|libell/i], ["desc2", /desc|detail|memo|payee|narrative|libell/i]
    ]
  };
  // For a file with no header row: work columns out from what's in them.
  function guessByContent(t, kind) {
    const sample = t.rows.slice(0, 300), roles = {};
    const stats = t.headers.map((h, c) => {
      const vals = sample.map(r => r.cells[c]).filter(v => v !== "");
      const dates = vals.filter(v => dateParts(v)).length;
      const nums = vals.filter(v => !dateParts(v) && /\d/.test(v) && parseMoney(v) !== null).length;
      return { c, filled: vals.length / Math.max(1, sample.length), date: dates / Math.max(1, vals.length), num: nums / Math.max(1, vals.length), len: vals.reduce((s, v) => s + v.length, 0) / Math.max(1, vals.length) };
    });
    const dateCol = stats.filter(s => s.date >= 0.8).sort((a, b) => b.date - a.date)[0];
    if (dateCol) roles.date = dateCol.c;
    const numeric = stats.filter(s => s.c !== roles.date && s.num >= 0.8);
    const text = stats.filter(s => s.c !== roles.date && s.num < 0.5).sort((a, b) => b.len - a.len);
    if (kind === "bank") {
      if (text[0]) roles.desc = text[0].c;
      let pair = null;
      for (let i = 0; i < numeric.length && !pair; i++) for (let j = i + 1; j < numeric.length && !pair; j++) {
        const a = numeric[i].c, b = numeric[j].c;
        const one = sample.filter(r => (r.cells[a] !== "") !== (r.cells[b] !== "")).length;
        if (one >= sample.length * 0.9) pair = [a, b];
      }
      if (pair) { roles.withdrawal = pair[0]; roles.deposit = pair[1]; }
      else if (numeric[0]) roles.amount = numeric[0].c;
    } else {
      if (numeric.length) roles.total = numeric[numeric.length - 1].c;
      const num = stats.find(s => s.c !== roles.date && sample.every(r => /^[A-Z#-]{0,6}\d+$/i.test(r.cells[s.c])));
      if (num) roles.number = num.c;
    }
    return roles;
  }
  function guessRoles(headers, kind, table) {
    if (table && table.noHeader) return guessByContent(table, kind);
    const roles = {}, taken = new Set();
    for (const [role, re] of PATTERNS[kind]) {
      const i = headers.findIndex((h, j) => !taken.has(j) && re.test(h));
      if (i >= 0) { roles[role] = i; taken.add(i); }
    }
    if (roles.amount !== undefined && (roles.deposit !== undefined || roles.withdrawal !== undefined)) delete roles.amount;
    return roles;
  }

  // Money to integer cents. Handles $, CA$, spaces, (brackets) and a decimal comma.
  function parseMoney(s) {
    let v = String(s || "").replace(/[\s\u00A0]/g, "").replace(/^(CA|CAD|C)?\$|\$$|CAD$/gi, "");
    if (v === "") return null;
    let neg = false;
    if (/^\(.*\)$/.test(v)) { neg = true; v = v.slice(1, -1); }
    if (/^-/.test(v)) { neg = !neg; v = v.slice(1); }
    v = v.replace(/^\$/, "");
    const lastDot = v.lastIndexOf("."), lastComma = v.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
      else v = v.replace(/,/g, "");
    } else if (lastComma >= 0) {
      v = /,\d{2}$/.test(v) && (v.match(/,/g) || []).length === 1 ? v.replace(",", ".") : v.replace(/,/g, "");
    }
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
    const [w, f = ""] = v.split(".");
    const c = parseInt(w, 10) * 100 + parseInt((f + "00").slice(0, 2), 10);
    return neg ? -c : c;
  }
  const fmtMoney = c => (c < 0 ? "-" : "") + "$" + Math.floor(Math.abs(c) / 100).toLocaleString("en-CA") + "." + String(Math.abs(c) % 100).padStart(2, "0");

  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const MOIS = { janvier: 1, janv: 1, fevrier: 2, fevr: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, novembre: 11, decembre: 12 };
  function monthOf(w) {
    const f = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\.$/, "");
    return MOIS[f] || MONTHS.indexOf(f.slice(0, 3)) + 1;
  }
  // Returns {y, m, d} when the order is known, {a, b, y} when it depends on the file's order, or null.
  function dateParts(s) {
    const v = String(s || "").trim().replace(/[T ]\d{1,2}:\d{2}.*$/, "");
    let r;
    if ((r = v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) return { y: +r[1], m: +r[2], d: +r[3] };
    if ((r = v.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) return { a: +r[1], b: +r[2], y: +r[3] };
    if ((r = v.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) { const m = monthOf(r[1]); return m ? { y: +r[3], m, d: +r[2] } : null; }
    const fr = v.replace(/^le\s+/i, "").replace(/^(\d{1,2})er\b/i, "$1");
    if ((r = fr.match(/^(\d{1,2})[\s-]+([A-Za-z\u00C0-\u00FF]{3,}\.?),?[\s-]+(\d{4})$/))) { const m = monthOf(r[2]); return m ? { y: +r[3], m, d: +r[1] } : null; }
    return null;
  }
  // Works out whether a file writes day or month first, from any date where one part is over 12.
  function detectOrder(values) {
    let day = null, month = null, needs = false;
    for (const v of values) {
      const p = dateParts(v);
      if (!p || p.a === undefined) continue;
      if (p.a > 12 && p.b <= 12) day = day || v;
      else if (p.b > 12 && p.a <= 12) month = month || v;
      else if (p.a !== p.b) needs = true;
    }
    if (day && month) return { order: "conflict", example: day + " and " + month };
    if (day) return { order: "day", example: day };
    if (month) return { order: "month", example: month };
    return { order: needs ? "unknown" : "none", example: "" };
  }
  function toDay(p, order) {
    if (!p) return null;
    let y = p.y, m = p.m, d = p.d;
    if (p.a !== undefined) {
      if (p.a === p.b) { m = p.a; d = p.b; }
      else if (order === "day") { d = p.a; m = p.b; }
      else if (order === "month") { m = p.a; d = p.b; }
      else return null;
    }
    if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
    return Date.UTC(y, m - 1, d) / 86400000;
  }
  const fmtDay = n => new Date(n * 86400000).toISOString().slice(0, 10);

  const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Finds invoice numbers named in a bank description.
  function findRefs(desc, byNorm, byDigits) {
    const up = String(desc).toUpperCase();
    const found = new Set(), unknown = new Set();
    const re = /(#\s*)?\b([A-Z]{1,4})?[\s\-_.:#]*(\d{3,})\b/g;
    let m;
    while ((m = re.exec(up))) {
      const hash = /#/.test(m[0]), prefix = m[2] || "", digits = m[3];
      const word = up.slice(Math.max(0, m.index - 9), m.index);
      const full = prefix + digits;
      if (prefix && byNorm.has(full)) { found.add(byNorm.get(full)); continue; }
      const invWord = /\b(INVOICE|INV|NO)[\s.:#]*$/.test(word) || /^(INV|INVOICE|NO)$/.test(prefix);
      if ((hash || invWord || prefix === "INV") && byDigits.has(digits)) { const n = byDigits.get(digits); if (n) { found.add(n); continue; } }
      if (prefix === "INV" || hash || invWord) unknown.add((prefix || "#") + (prefix ? "-" : "") + digits);
    }
    return { found: [...found], unknown: [...unknown] };
  }

  function readInvoices(t, roles, order) {
    const out = [], skipped = [], seen = new Map();
    for (const tr of t.totalRows || []) skipped.push({ file: "Invoices", row: tr, reason: "Totals row, left out" });
    const get = (r, k) => roles[k] === undefined ? "" : r.cells[roles[k]];
    for (const r of t.rows) {
      const num = get(r, "number");
      const bad = why => skipped.push({ file: "Invoices", row: r.row, reason: why });
      if (!num) { bad("No invoice number"); continue; }
      if (seen.has(norm(num))) { bad("Invoice number " + num + " already appears on row " + seen.get(norm(num))); continue; }
      const day = toDay(dateParts(get(r, "date")), order);
      if (day === null) { bad("Invoice date \"" + get(r, "date") + "\" isn't a date that can be read"); continue; }
      const total = parseMoney(get(r, "total"));
      if (total === null) { bad("Total \"" + get(r, "total") + "\" isn't a number"); continue; }
      const hasTax = roles.subtotal !== undefined && roles.tax !== undefined;
      const sub = hasTax ? parseMoney(get(r, "subtotal")) : null, tax = hasTax ? (get(r, "tax") === "" ? 0 : parseMoney(get(r, "tax"))) : null;
      if (hasTax && (sub === null || tax === null)) { bad("Subtotal or tax isn't a number"); continue; }
      seen.set(norm(num), r.row);
      const code = roles.code === undefined ? "H13" : (get(r, "code").toUpperCase().replace(/\s/g, "") || "H13");
      out.push({ num, customer: get(r, "customer"), day, sub, tax, total, code, row: r.row, paid: 0, links: [] });
    }
    return { invoices: out, skipped };
  }

  function readBank(t, roles, order) {
    const deposits = [], skipped = [];
    for (const tr of t.totalRows || []) skipped.push({ file: "Bank", row: tr, reason: "Totals row, left out" });
    let withdrawals = 0;
    const get = (r, k) => roles[k] === undefined ? "" : r.cells[roles[k]];
    for (const r of t.rows) {
      const bad = why => skipped.push({ file: "Bank", row: r.row, reason: why });
      const day = toDay(dateParts(get(r, "date")), order);
      if (day === null) { bad("Date \"" + get(r, "date") + "\" isn't a date that can be read"); continue; }
      let amt;
      if (roles.amount !== undefined) {
        amt = parseMoney(get(r, "amount"));
        if (amt === null) { bad("Amount \"" + get(r, "amount") + "\" isn't a number"); continue; }
      } else {
        const dep = parseMoney(get(r, "deposit")), wd = parseMoney(get(r, "withdrawal"));
        if (dep === null && wd === null) { bad("No deposit or withdrawal amount"); continue; }
        amt = (dep || 0) - Math.abs(wd || 0);
      }
      if (amt <= 0) { withdrawals++; continue; }
      deposits.push({ row: r.row, day, desc: [get(r, "desc"), get(r, "desc2")].filter(Boolean).join(" "), amt, links: [], status: "" });
    }
    return { deposits, withdrawals, skipped };
  }

  const TYPES = {
    unmatched: "Payment with no invoice", unpaid: "Invoice with no payment", partial: "Partly paid",
    duplicate: "Duplicate payment", overpaid: "Overpayment", review: "Needs review",
    hst: "Tax isn't 13% HST", taxonexempt: "Tax on an untaxed invoice", totalmismatch: "Total doesn't add up", taxcode: "Unknown tax code"
  };

  function reconcile(invT, invRoles, invOrder, bankT, bankRoles, bankOrder, windowDays, manual) {
    manual = manual || {};
    const { invoices, skipped: s1 } = readInvoices(invT, invRoles, invOrder);
    const { deposits, withdrawals, skipped: s2 } = readBank(bankT, bankRoles, bankOrder);
    const exceptions = [];
    const exc = (type, o) => exceptions.push(Object.assign({ type, label: TYPES[type], invoice: "", payRow: null, payDay: null, amount: null, reason: "" }, o));
    const byNorm = new Map(), digitCount = new Map(), byDigits = new Map();
    for (const inv of invoices) {
      byNorm.set(norm(inv.num), inv.num);
      const d = (inv.num.match(/(\d+)\D*$/) || [])[1];
      if (d) { digitCount.set(d, (digitCount.get(d) || 0) + 1); byDigits.set(d, inv.num); }
    }
    for (const [d, n] of digitCount) if (n > 1) byDigits.set(d, null);
    const byNum = new Map(invoices.map(i => [i.num, i]));
    const order = deposits.slice().sort((a, b) => a.day - b.day || a.row - b.row);
    const link = (dep, inv, amt, rule) => { inv.paid += amt; inv.links.push({ row: dep.row, amt }); dep.links.push({ num: inv.num, amt, rule }); };

    function applyRef(dep, inv, rule) {
      const bal = inv.total - inv.paid;
      if (bal <= 0) {
        const same = dep.amt === inv.total || inv.links.some(l => l.amt === dep.amt);
        exc(same ? "duplicate" : "overpaid", { invoice: inv.num, payRow: dep.row, payDay: dep.day, amount: dep.amt,
          reason: (same ? "Same amount as a payment already received for " : "Extra payment for ") + inv.num + ", which was already paid in full" + (inv.links.length ? " by bank row " + inv.links.map(l => l.row).join(" and ") : "") + "." });
        dep.status = "exception";
        return;
      }
      if (dep.amt > bal) {
        link(dep, inv, dep.amt, rule);
        exc("overpaid", { invoice: inv.num, payRow: dep.row, payDay: dep.day, amount: dep.amt, reason: "Paid " + fmtMoney(dep.amt) + " when " + fmtMoney(bal) + " was owing, " + fmtMoney(dep.amt - bal) + " too much." });
        dep.status = "matched";
        return;
      }
      link(dep, inv, dep.amt, rule);
      dep.status = "matched";
    }

    // Pass 0: matches a person made by hand
    for (const dep of order) {
      const n = manual[dep.row];
      if (n && byNum.has(n)) { applyRef(dep, byNum.get(n), "Matched by hand"); dep.manual = true; }
    }
    // Pass 1: payments that name an invoice
    for (const dep of order) {
      if (dep.status) continue;
      const refs = findRefs(dep.desc, byNorm, byDigits);
      dep.unknown = refs.unknown;
      if (refs.found.length === 1) applyRef(dep, byNum.get(refs.found[0]), "Invoice number in description");
      else if (refs.found.length > 1) {
        const invs = refs.found.map(n => byNum.get(n));
        const owing = invs.reduce((s, i) => s + Math.max(0, i.total - i.paid), 0);
        if (owing === dep.amt && invs.every(i => i.total > i.paid)) { invs.forEach(i => link(dep, i, i.total - i.paid, "Invoice numbers in description")); dep.status = "matched"; }
        else { exc("review", { invoice: refs.found.join(", "), payRow: dep.row, payDay: dep.day, amount: dep.amt, reason: "Names " + refs.found.join(" and ") + ", but the amount doesn't equal what's owing on them (" + fmtMoney(owing) + ")." }); dep.status = "exception"; }
      }
    }
    // Pass 2: payments with no invoice number, by exact balance inside the date window
    for (const dep of order) {
      if (dep.status) continue;
      const cands = invoices.filter(i => i.total - i.paid === dep.amt && dep.day >= i.day && dep.day <= i.day + windowDays);
      const named = dep.unknown && dep.unknown.length ? " It names " + dep.unknown.join(", ") + ", which isn't in the invoice list." : "";
      if (cands.length === 1) { link(dep, cands[0], dep.amt, "Amount and date" + (named ? " (named invoice not found)" : "")); dep.status = "matched"; }
      else if (cands.length > 1) { exc("review", { invoice: cands.map(c => c.num).join(", "), payRow: dep.row, payDay: dep.day, amount: dep.amt, reason: "Could be any of " + cands.length + " invoices with the same balance: " + cands.map(c => c.num).join(", ") + "." + named }); dep.status = "exception"; }
      else {
        exc("unmatched", { payRow: dep.row, payDay: dep.day, amount: dep.amt, reason: named ? named.trim() + " No other invoice matches the amount." : "No invoice number in the description, and no invoice with a balance of " + fmtMoney(dep.amt) + " dated up to " + windowDays + " days before it." });
        dep.status = "exception";
      }
    }
    // Invoice-level checks
    for (const inv of invoices) {
      if (inv.paid === 0) exc("unpaid", { invoice: inv.num, amount: inv.total, reason: "No payment found for " + inv.num + (inv.customer ? " (" + inv.customer + ")" : "") + ", dated " + fmtDay(inv.day) + "." });
      else if (inv.paid < inv.total) exc("partial", { invoice: inv.num, amount: inv.total - inv.paid, reason: "Paid " + fmtMoney(inv.paid) + " of " + fmtMoney(inv.total) + ". " + fmtMoney(inv.total - inv.paid) + " still owing." });
      if (inv.sub === null) continue;
      if (inv.code === "H13") {
        const expected = Math.floor((inv.sub * HST_RATE + 50) / 100);
        if (Math.abs(inv.tax - expected) > 1) exc("hst", { invoice: inv.num, amount: inv.tax, reason: "Tax is " + fmtMoney(inv.tax) + ". 13% of " + fmtMoney(inv.sub) + " is " + fmtMoney(expected) + "." });
      } else if (inv.code === "EXEMPT" || inv.code === "ZERO") {
        if (inv.tax !== 0) exc("taxonexempt", { invoice: inv.num, amount: inv.tax, reason: "Tax code " + inv.code + " means no tax, but " + fmtMoney(inv.tax) + " tax was charged." });
      } else {
        exc("taxcode", { invoice: inv.num, amount: inv.tax, reason: "Tax code \"" + inv.code + "\" isn't H13, EXEMPT or ZERO, so the tax wasn't checked." });
      }
    }
    for (const inv of invoices) {
      if (inv.sub !== null && inv.sub + inv.tax !== inv.total) exc("totalmismatch", { invoice: inv.num, amount: inv.total, reason: "Subtotal " + fmtMoney(inv.sub) + " plus tax " + fmtMoney(inv.tax) + " is " + fmtMoney(inv.sub + inv.tax) + ", but the total says " + fmtMoney(inv.total) + "." });
    }
    const matched = [];
    for (const dep of order) for (const l of dep.links) {
      const inv = byNum.get(l.num);
      const status = inv.paid === inv.total ? (inv.links.length > 1 ? "Paid in " + inv.links.length + " payments" : "Paid") : inv.paid < inv.total ? "Partly paid" : "Overpaid";
      matched.push({ payRow: dep.row, payDay: dep.day, desc: dep.desc, amount: l.amt, invoice: l.num, rule: l.rule, status });
    }
    const rank = { duplicate: 1, unmatched: 2, overpaid: 3, review: 4, partial: 5, unpaid: 6, totalmismatch: 7, hst: 8, taxonexempt: 9, taxcode: 10 };
    exceptions.sort((a, b) => rank[a.type] - rank[b.type] || (a.payRow || 0) - (b.payRow || 0) || a.invoice.localeCompare(b.invoice));
    const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
    const totals = {
      invoiced: sum(invoices, i => i.total),
      collected: sum(invoices, i => Math.min(i.paid, i.total)),
      owing: sum(invoices, i => Math.max(0, i.total - i.paid)),
      received: sum(deposits, d => d.amt),
      depMatched: sum(matched, m => m.amount),
      depDuplicate: sum(exceptions.filter(e => e.type === "duplicate" || (e.type === "overpaid" && e.payRow !== null && !deposits.find(d => d.row === e.payRow).links.length)), e => e.amount),
      depUnmatched: sum(exceptions.filter(e => e.type === "unmatched"), e => e.amount),
      depReview: sum(exceptions.filter(e => e.type === "review"), e => e.amount)
    };
    const taxChecked = invRoles.subtotal !== undefined && invRoles.tax !== undefined;
    return { invoices, deposits, withdrawals, matched, exceptions, skipped: s1.concat(s2), totals, windowDays, taxChecked, manualCount: deposits.filter(d => d.manual).length };
  }

  function toCSV(headers, rows) {
    const q = v => { const s = String(v); return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [headers, ...rows].map(r => r.map(q).join(",")).join("\r\n") + "\r\n";
  }

  return { ROLES, TYPES, parseCSV, guessRoles, parseMoney, fmtMoney, dateParts, detectOrder, findRefs, reconcile, toCSV, fmtDay };
})();
window.Recon = Recon;
/* CORE-END */

const SAMPLE_INV = __SAMPLE_INV__;
const SAMPLE_BANK = __SAMPLE_BANK__;

(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const state = { inv: null, bank: null, roles: { inv: {}, bank: {} }, order: { inv: "none", bank: "none" }, result: null, filter: "all", showAll: { exc: false, matched: false }, manual: {} };
  const M = Recon.fmtMoney;

  function setError(id, msg) { $(id).textContent = msg || ""; }

  function loadText(kind, text, label) {
    const name = kind === "inv" ? "invoices file" : "bank file";
    try {
      if (!text || !text.trim()) throw new Error("The " + name + " is empty.");
      state[kind] = Recon.parseCSV(text, name);
    } catch (e) {
      state[kind] = null;
      $(kind === "inv" ? "inv-status" : "bank-status").textContent = "Couldn't read " + label + ".";
      setError("load-error", e.message);
      return false;
    }
    const t = state[kind];
    $(kind === "inv" ? "inv-status" : "bank-status").textContent = label + ": " + t.rows.length + " rows, " + t.headers.length + " columns.";
    state.roles[kind] = Recon.guessRoles(t.headers, kind, t);
    state.manual = {};
    const di = state.roles[kind].date;
    state.order[kind] = di === undefined ? "none" : Recon.detectOrder(t.rows.map(r => r.cells[di])).order;
    return true;
  }

  function afterLoad() {
    state.result = null;
    $("step-results").hidden = true;
    if (!state.inv || !state.bank) { $("step-map").hidden = true; return; }
    setError("load-error", "");
    renderRoles();
    const problems = validate().filter(p => !/days/.test(p));
    const headless = ["inv", "bank"].filter(k => state[k].noHeader);
    $("map-details").open = problems.length > 0 || headless.length > 0;
    const named = k => { const di = state.roles[k].date; return di !== undefined && state[k].rows.slice(0, 20).some(r => /[A-Za-z\u00C0-\u00FF]{3,}/.test(r.cells[di])); };
    const orderText = k => named(k) && state.order[k] === "none" ? "written with month names" : ({ none: "year first", day: "day first", month: "month first" }[state.order[k]] || "unclear");
    const name = k => k === "inv" ? "invoices file" : "bank file";
    const notes = [];
    for (const k of headless) notes.push("The " + name(k) + " has no header row, so its columns were matched by what's in them. Check them below.");
    for (const k of ["inv", "bank"]) if (state[k].titleRows) notes.push("Skipped " + state[k].titleRows + (state[k].titleRows === 1 ? " title line" : " title lines") + " above the header in the " + name(k) + ".");
    if (state.roles.inv.subtotal === undefined || state.roles.inv.tax === undefined) notes.push("The invoices file has no subtotal or tax column, so the tax and total checks will be skipped.");
    $("map-summary").textContent = (problems.length
      ? "Some columns or date orders need your choice before matching. They're listed below."
      : "Found every column needed in both files. Invoice dates are " + orderText("inv") + " and bank dates are " + orderText("bank") + ".") + (notes.length ? " " + notes.join(" ") : "");
    $("step-map").hidden = false;
    $("h-map").focus({ preventScroll: true });
    $("step-map").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function renderRoles() {
    for (const kind of ["inv", "bank"]) {
      const t = state[kind], roles = state.roles[kind];
      const first = i => { const r = t.rows.find(x => x.cells[i] !== ""); return r ? r.cells[i] : ""; };
      const opts = '<option value="">Not in this file</option>' + t.headers.map((h, i) => '<option value="' + i + '">' + esc(h) + (t.noHeader ? ", like " + esc(first(i).slice(0, 30)) : "") + "</option>").join("");
      let html = Recon.ROLES[kind].map(([role, label, req]) =>
        '<div class="role"><label for="r-' + kind + "-" + role + '">' + esc(label) + (req ? "" : ' <span class="muted small">(optional)</span>') + "</label>" +
        '<select id="r-' + kind + "-" + role + '" data-kind="' + kind + '" data-role="' + role + '">' + opts + "</select></div>").join("");
      html += '<div class="role"><label for="o-' + kind + '">Date order</label><select id="o-' + kind + '" data-kind="' + kind + '" data-order="1">' +
        '<option value="none">Year first, like 2026-07-03</option><option value="day">Day first, like 03/07/2026</option><option value="month">Month first, like 07/03/2026</option><option value="unknown">Not sure</option></select></div>';
      $("roles-" + kind).innerHTML = html;
      for (const [role] of Recon.ROLES[kind]) $("r-" + kind + "-" + role).value = roles[role] === undefined ? "" : String(roles[role]);
      $("o-" + kind).value = state.order[kind] === "conflict" ? "unknown" : state.order[kind];
      orderHint(kind);
    }
  }
  function orderHint(kind) {
    const t = state[kind], di = state.roles[kind].date;
    const det = di === undefined ? { order: "none" } : Recon.detectOrder(t.rows.map(r => r.cells[di]));
    const msg = { day: "Dates read as day first, because of " + det.example + ".", month: "Dates read as month first, because of " + det.example + ".",
      none: "", unknown: "Some dates could be day or month first. Choose the date order above.", conflict: "This file mixes date orders (" + det.example + "). Check the date column." }[det.order];
    $("hint-" + kind).textContent = msg;
  }

  document.addEventListener("change", e => {
    const el = e.target;
    if (!el.dataset.kind) return;
    const kind = el.dataset.kind;
    if (el.dataset.order) state.order[kind] = el.value;
    else if (el.value === "") delete state.roles[kind][el.dataset.role];
    else state.roles[kind][el.dataset.role] = +el.value;
    if (el.dataset.role === "date") { const di = state.roles[kind].date; state.order[kind] = di === undefined ? "none" : Recon.detectOrder(state[kind].rows.map(r => r.cells[di])).order; $("o-" + kind).value = state.order[kind] === "conflict" ? "unknown" : state.order[kind]; orderHint(kind); }
    markStale();
  });
  $("window").addEventListener("input", markStale);

  function markStale() {
    if (!state.result) return;
    $("stale").textContent = "You changed a setting, so these results are out of date. Tap Match payments to update them.";
    $("stale").hidden = false;
    $("btn-run").textContent = "Match payments again";
  }

  function validate() {
    const missing = [];
    for (const kind of ["inv", "bank"]) {
      for (const [role, label, req] of Recon.ROLES[kind]) if (req && state.roles[kind][role] === undefined) missing.push((kind === "inv" ? "Invoices: " : "Bank: ") + label);
      if (state.order[kind] === "unknown" || state.order[kind] === "conflict") missing.push((kind === "inv" ? "Invoices" : "Bank") + ": date order");
    }
    const b = state.roles.bank;
    if (b.amount === undefined && b.deposit === undefined) missing.push("Bank: an amount column or a deposit column");
    const w = +$("window").value;
    if (!Number.isInteger(w) || w < 1 || w > 365) missing.push("A number of days from 1 to 365");
    return missing;
  }

  function run() {
    const missing = validate();
    if (missing.length) { setError("map-error", "Choose these before matching: " + missing.join("; ") + "."); return; }
    setError("map-error", "");
    state.result = Recon.reconcile(state.inv, state.roles.inv, state.order.inv, state.bank, state.roles.bank, state.order.bank, +$("window").value, state.manual);
    state.filter = "all";
    state.showAll = { exc: false, matched: false };
    $("stale").hidden = true;
    $("btn-run").textContent = "Match payments";
    $("step-results").hidden = false;
    render();
    $("h-results").focus();
  }

  function render() {
    const r = state.result;
    const deps = r.deposits.length, inv = r.invoices.length;
    const invLinked = new Set(r.matched.map(m => m.invoice)).size;
    const payLinked = new Set(r.matched.map(m => m.payRow)).size;
    const n = (k, one, many) => "<b>" + k + "</b> " + (k === 1 ? one : many);
    $("summary").innerHTML = n(deps, "deposit", "deposits") + " and " + n(inv, "invoice", "invoices") + " checked. " + n(payLinked, "payment", "payments") + " matched to " + n(invLinked, "invoice", "invoices") + ". " +
      n(r.exceptions.length, "exception needs", "exceptions need") + " a person to look." +
      (r.withdrawals ? " " + r.withdrawals + (r.withdrawals === 1 ? " withdrawal was" : " withdrawals were") + " left out." : "") +
      (r.manualCount ? " " + r.manualCount + (r.manualCount === 1 ? " payment was" : " payments were") + " matched by hand." : "") +
      (r.taxChecked ? "" : " Tax and total checks were skipped because the invoices file has no subtotal or tax column.");
    renderMoney();
    renderHand();
    renderExcBars();
    renderFilter();
    renderTables();
    const sk = r.skipped;
    $("skipped-wrap").hidden = !sk.length;
    if (sk.length) $("skipped").innerHTML = table(["File", "Row", "Problem"], sk.map(s => [esc(s.file), s.row, esc(s.reason)]), null);
  }

  function moneyRow(title, total, parts) {
    const segs = parts.filter(p => p[1] > 0);
    return '<div class="money-row"><h4>' + esc(title) + " " + M(total) + '</h4><div class="money-bar" aria-hidden="true">' +
      segs.map(p => '<span class="' + p[2] + '" style="width:' + (p[1] / total * 100).toFixed(2) + '%"></span>').join("") + '</div><ul class="money-legend">' +
      parts.map(p => '<li><span class="sw ' + p[2].replace("seg", "sw") + '"></span>' + esc(p[0]) + " <b>" + M(p[1]) + "</b></li>").join("") + "</ul></div>";
  }
  function renderHand() {
    const rows = Object.keys(state.manual).map(Number).sort((a, b) => a - b);
    $("hand").hidden = !rows.length;
    $("hand").innerHTML = rows.length ? "<h4>Matched by hand</h4><ul>" + rows.map(r => "<li><span>Bank row " + r + " to " + esc(state.manual[r]) + '</span><button class="btn btn-quiet" type="button" data-unmatch="' + r + '">Undo</button></li>').join("") + "</ul>" : "";
  }
  function renderMoney() {
    const t = state.result.totals;
    $("money").innerHTML =
      moneyRow("Invoiced", t.invoiced, [["Collected", t.collected, "seg-ok"], ["Still owing", t.owing, "seg-owing"]]) +
      moneyRow("Deposited", t.received, [["Matched to invoices", t.depMatched, "seg-ok"], ["Duplicate or extra", t.depDuplicate, "seg-bad"], ["No invoice found", t.depUnmatched, "seg-owing"], ["Needs review", t.depReview, "seg-review"]].filter(p => p[1] > 0 || p[2] === "seg-ok"));
  }
  function renderExcBars() {
    const counts = {};
    for (const e of state.result.exceptions) counts[e.label] = (counts[e.label] || 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { $("bars-exc").innerHTML = '<p class="muted">No exceptions. Every payment matched and every invoice is paid.</p>'; return; }
    const max = Math.max(...entries.map(e => e[1]));
    $("bars-exc").innerHTML = entries.map(([k, n]) => '<div class="bar-row"><span>' + esc(k) + '</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:' + (n / max * 100).toFixed(1) + '%"></span></span><span class="n">' + n + "</span></div>").join("");
  }
  function renderFilter() {
    const ex = state.result.exceptions, types = [...new Set(ex.map(e => e.type))];
    $("filter-wrap").hidden = types.length < 2;
    $("filter").innerHTML = '<option value="all">All exceptions (' + ex.length + ")</option>" +
      types.map(t => '<option value="' + t + '">' + esc(Recon.TYPES[t]) + " (" + ex.filter(e => e.type === t).length + ")</option>").join("");
    $("filter").value = state.filter;
  }
  $("filter").addEventListener("change", () => {
    state.filter = $("filter").value;
    state.showAll.exc = false;
    renderTables();
  });

  const payCell = (row, day) => row === null ? '<span class="muted">None</span>' : "Bank row " + row + ", " + Recon.fmtDay(day);
  function renderTables() {
    const r = state.result;
    const ex = r.exceptions.filter(e => state.filter === "all" || e.type === state.filter);
    const open = r.invoices.filter(i => i.total - i.paid > 0);
    const picker = e => {
      if (e.payRow === null || (e.type !== "unmatched" && e.type !== "review") || !open.length) return "";
      const opts = open.slice().sort((a, b) => Math.abs(a.total - a.paid - e.amount) - Math.abs(b.total - b.paid - e.amount) || b.day - a.day).slice(0, 200)
        .map(i => '<option value="' + esc(i.num) + '">' + esc(i.num) + " owes " + M(i.total - i.paid) + (i.customer ? ", " + esc(i.customer) : "") + "</option>").join("");
      return '<div class="manual"><label for="mm-' + e.payRow + '">Match this payment to</label><select id="mm-' + e.payRow + '">' + opts + '</select><button class="btn btn-quiet" type="button" data-manual="' + e.payRow + '">Match</button></div>';
    };
    $("exceptions").innerHTML = table(["Problem", "Invoice", "Payment", "Amount", "Why"],
      ex.map(e => ['<span class="tag tag-bad">' + esc(e.label) + "</span>", e.invoice ? esc(e.invoice) : '<span class="muted">None</span>', payCell(e.payRow, e.payDay), M(e.amount), esc(e.reason) + picker(e)]), "exc", "exceptions", 3);
    $("matched").innerHTML = table(["Invoice", "Status", "Payment", "Amount", "Bank description", "Matched by"],
      r.matched.map(m => [esc(m.invoice), '<span class="tag">' + esc(m.status) + "</span>", payCell(m.payRow, m.payDay), M(m.amount), esc(m.desc),
        esc(m.rule) + (m.rule === "Matched by hand" ? ' <button class="btn btn-quiet btn-inline" type="button" data-unmatch="' + m.payRow + '">Undo this match</button>' : "")]), "matched", "matched payments", 3);
  }
  function table(headers, rows, key, noun, moneyCol) {
    if (!rows.length) return '<p class="muted">None.</p>';
    const limit = key && !state.showAll[key] ? 20 : 1000;
    const shown = rows.slice(0, limit);
    let html = '<div class="scroll stack-wrap"><table class="stack" role="table"><thead role="rowgroup"><tr role="row">' + headers.map(h => '<th scope="col" role="columnheader">' + h + "</th>").join("") + '</tr></thead><tbody role="rowgroup">' +
      shown.map(r => '<tr role="row">' + r.map((v, i) => '<td role="cell" data-label="' + headers[i] + '"' + (i === moneyCol ? ' class="money-cell"' : "") + ">" + v + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
    if (key && rows.length > shown.length) html += '<div class="actions"><button class="btn btn-quiet" data-more="' + key + '" type="button">Show all ' + rows.length + " " + noun + "</button></div>";
    else if (rows.length > 1000) html += '<p class="small muted">Showing the first 1,000 of ' + rows.length + ". The download has all of them.</p>";
    return html;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-more]");
    if (!b) return;
    state.showAll[b.dataset.more] = true;
    renderTables();
  });
  // Manual matching reruns the whole reconciliation, so partial payments, duplicates and totals stay consistent.
  function rerun(message) {
    state.result = Recon.reconcile(state.inv, state.roles.inv, state.order.inv, state.bank, state.roles.bank, state.order.bank, +$("window").value, state.manual);
    $("stale").hidden = true; $("btn-run").textContent = "Match payments";
    render();
    $("announce").textContent = message;
    $("h-exceptions").focus();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-manual], [data-unmatch]");
    if (!b) return;
    if (b.dataset.manual) {
      const row = +b.dataset.manual, num = $("mm-" + row).value;
      state.manual[row] = num;
      rerun("Bank row " + row + " matched to " + num + " by hand.");
    } else {
      const row = +b.dataset.unmatch;
      delete state.manual[row];
      rerun("Hand match for bank row " + row + " undone.");
    }
  });

  function download(filename, text) {
    const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const money = c => (c < 0 ? "-" : "") + Math.floor(Math.abs(c) / 100) + "." + String(Math.abs(c) % 100).padStart(2, "0");
  $("dl-exc").addEventListener("click", () => {
    download("exceptions.csv", Recon.toCSV(["Problem", "Invoice", "Bank row", "Payment date", "Amount", "Why"],
      state.result.exceptions.map(e => [e.label, e.invoice, e.payRow === null ? "" : e.payRow, e.payDay === null ? "" : Recon.fmtDay(e.payDay), money(e.amount), e.reason])));
  });
  $("dl-matched").addEventListener("click", () => {
    download("matched-payments.csv", Recon.toCSV(["Invoice", "Invoice status", "Bank row", "Payment date", "Amount applied", "Bank description", "Matched by"],
      state.result.matched.map(m => [m.invoice, m.status, m.payRow, Recon.fmtDay(m.payDay), money(m.amount), m.desc, m.rule])));
  });

  function readFile(input, kind) {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(reader.result); }
      catch (e) { text = new TextDecoder("windows-1252").decode(reader.result); }
      setError("load-error", "");
      if (loadText(kind, text, f.name)) afterLoad();
      input.value = "";
    };
    reader.onerror = () => setError("load-error", "The file couldn't be read. Try saving it again as CSV.");
    reader.readAsArrayBuffer(f);
  }
  $("btn-inv").addEventListener("click", () => $("file-inv").click());
  $("btn-bank").addEventListener("click", () => $("file-bank").click());
  $("file-inv").addEventListener("change", () => readFile($("file-inv"), "inv"));
  $("file-bank").addEventListener("change", () => readFile($("file-bank"), "bank"));
  $("btn-sample").addEventListener("click", () => {
    setError("load-error", "");
    loadText("inv", SAMPLE_INV, "Sample invoices");
    loadText("bank", SAMPLE_BANK, "Sample bank statement");
    $("window").value = 45;
    afterLoad();
  });
  $("dl-sample-inv").addEventListener("click", () => download("sample-invoices.csv", SAMPLE_INV));
  $("dl-sample-bank").addEventListener("click", () => download("sample-bank.csv", SAMPLE_BANK));
  $("btn-paste").addEventListener("click", () => {
    setError("load-error", "");
    const a = loadText("inv", $("paste-inv").value, "Pasted invoices");
    const b = a && loadText("bank", $("paste-bank").value, "Pasted bank statement");
    if (a && b) afterLoad();
  });
  $("btn-run").addEventListener("click", run);
  $("btn-reset").addEventListener("click", () => {
    state.inv = state.bank = state.result = null;
    state.manual = {};
    $("step-map").hidden = true; $("step-results").hidden = true;
    $("inv-status").textContent = "No file loaded yet."; $("bank-status").textContent = "No file loaded yet.";
    $("paste-inv").value = ""; $("paste-bank").value = "";
    setError("load-error", ""); setError("map-error", "");
    $("btn-sample").focus();
    window.scrollTo(0, 0);
  });
})();
