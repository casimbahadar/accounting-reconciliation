# Headless tests for demo 2 against the shipped out/index.html.
import json, csv, io, time, random, sys, os, subprocess
from collections import Counter
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXP = json.load(open(os.path.join(ROOT, "expected.json")))
TYPE_OF = {"Payment with no invoice":"unmatched","Invoice with no payment":"unpaid","Partly paid":"partial","Duplicate payment":"duplicate",
           "Overpayment":"overpaid","Needs review":"review","Tax isn't 13% HST":"hst","Tax on an untaxed invoice":"taxonexempt","Total doesn't add up":"totalmismatch","Unknown tax code":"taxcode"}
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  :: " + str(detail)[:700]))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8098", "--bind", "127.0.0.1", "-d", os.path.join(ROOT, "out")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = "http://127.0.0.1:8098/index.html"
def rcsv(p):
    t = open(p, encoding="utf-8").read(); t = t[1:] if t.startswith("\ufeff") else t
    return list(csv.reader(io.StringIO(t)))
def grab(page, btn):
    with page.expect_download() as d: page.click(btn)
    return rcsv(d.value.path())
errors = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, accept_downloads=True)
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
    page = ctx.new_page(); page.set_default_timeout(8000)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    page.goto(URL); page.wait_for_selector("#btn-sample")

    # ---- main run: 2 taps
    page.click("#btn-sample"); page.click("#btn-run"); page.wait_for_selector("#step-results:not([hidden])")
    check("core task takes 2 taps: load sample, match", page.is_visible("#step-results"))
    summ = page.inner_text("#map-summary")
    check("everything detected: column list stays collapsed, summary names the date orders", "bank dates are month first" in summ and "Invoice dates are year first" in summ and page.evaluate("document.getElementById('map-details').open") is False, summ)
    m = grab(page, "#dl-matched")
    got = sorted([[int(r[2]), r[0], "reference" if r[6].startswith("Invoice number") else "amount"] for r in m[1:]])
    exp = sorted(EXP["matched"])
    check("matched list = exactly the 38 planned payment-invoice links, each by the planned rule", got == exp,
          {"missing": [x for x in exp if x not in got], "extra": [x for x in got if x not in exp]})
    e = grab(page, "#dl-exc")
    gotx = sorted([[TYPE_OF[r[0]], r[1], int(r[2]) if r[2] else None] for r in e[1:]], key=lambda x: (x[0], x[1], x[2] or 0))
    expx = EXP["exceptions"]
    check("exceptions = exactly the 14 planted (3 unmatched, 3 unpaid, 2 partial, 2 duplicate, 2 HST, 1 tax on untaxed, 1 total)", gotx == expx,
          {"missing": [x for x in expx if x not in gotx], "extra": [x for x in gotx if x not in expx]})
    check("every exception has a reason", all(len(r[5]) > 10 for r in e[1:]))
    tr = EXP["traps"]
    inv_rows = {r[0]: r for r in m[1:]}
    check("trap: same-amount invoices INV-1005 and INV-1006 each matched by their own reference",
          sum(1 for r in m[1:] if r[0] in tr["same_amount"] and r[6].startswith("Invoice number")) == 2)
    check("trap: payment 70 days late still matched by its invoice number", tr["late"] in inv_rows)
    flagged = {r[1] for r in e[1:]}
    check("trap: one-cent rounding difference not flagged", tr["rounding"] not in flagged)
    check("trap: EXEMPT and ZERO invoices with no tax not flagged", tr["exempt"] not in flagged and tr["zero"] not in flagged)
    reasons = {r[1]: r[5] for r in e[1:]}
    check("new rule: ZERO invoice charging tax is flagged with the amount", "INV-1019" in reasons and "$62.43 tax was charged" in reasons["INV-1019"], reasons.get("INV-1019"))
    check("new rule: total $10.00 off is flagged with the arithmetic", "INV-1023" in reasons and "is $171.05, but the total says $181.05" in reasons["INV-1023"], reasons.get("INV-1023"))
    check("new rules: the mismatched-total invoice is still matched to its payment", "INV-1023" in inv_rows)
    split = [r for r in m[1:] if r[0] == tr["split"]]
    check("trap: invoice paid in two instalments shows 'Paid in 2 payments', not partly paid", len(split) == 2 and all(r[1] == "Paid in 2 payments" for r in split) and tr["split"] not in flagged, split)
    tot = page.evaluate("(() => { const s = document.getElementById('summary').textContent; return s; })()")
    check("summary counts come from the data", "43 deposits" in tot and "40 invoices" in tot and "38 payments matched to 37 invoices" in tot and "14 exceptions" in tot and "5 withdrawals" in tot, tot)
    money = page.inner_text("#money")
    check("money bars show amounts that add up (checked in engine)", "Collected" in money and "Still owing" in money and "No invoice found" in money, money)
    page.select_option("#filter", "duplicate")
    check("Show filter narrows the list (2 duplicates)", page.eval_on_selector_all("#exceptions tbody tr", "e => e.length") == 2)
    page.select_option("#filter", "all")
    page.set_viewport_size({"width": 320, "height": 700})
    ov = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check("no sideways page scroll at 320px", ov <= 0, ov)
    page.set_viewport_size({"width": 390, "height": 844})
    ov = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check("no sideways page scroll at 390px", ov <= 0, ov)
    page.screenshot(path=os.path.join(ROOT, "shots", "d2-390-results.png"), full_page=True)

    # ---- window setting and stale notice
    page.fill("#window", "1")
    check("changing the window marks results out of date", page.is_visible("#stale") and page.inner_text("#btn-run") == "Match payments again")
    page.click("#btn-run")
    e2 = grab(page, "#dl-exc")
    from collections import Counter
    c2 = Counter(TYPE_OF[r[0]] for r in e2[1:])
    check("1-day window: the 4 amount-only payments become unmatched and their invoices unpaid", c2["unmatched"] == 7 and c2["unpaid"] == 7 and not page.is_visible("#stale"), c2)
    page.fill("#window", "0"); page.click("#btn-run")
    check("invalid window shows an error", "1 to 365" in page.inner_text("#map-error"))
    page.fill("#window", "45"); page.click("#btn-run")

    def paste(inv, bank):
        page.click("#btn-reset") if page.is_visible("#btn-reset") else None
        page.evaluate("document.getElementById('paste-box').open = true")
        page.fill("#paste-inv", inv); page.fill("#paste-bank", bank); page.click("#btn-paste")
    H = "Invoice number,Customer,Invoice date,Subtotal,Tax code,Tax,Total\n"
    # ---- ambiguous amount: never guessed
    paste(H + "A-1,Ana,2026-07-01,100.00,H13,13.00,113.00\nA-2,Bo,2026-07-02,100.00,H13,13.00,113.00\n", "Date,Description,Amount\n2026-07-10,E-TRANSFER RECEIVED,113.00\n")
    page.click("#btn-run"); page.wait_for_selector("#step-results:not([hidden])")
    ex = page.inner_text("#exceptions")
    check("two invoices with the same balance: 'Needs review', not a guess", "Needs review" in ex and "Could be any of 2" in ex and page.inner_text("#matched").strip() == "None.", ex[:300])
    # ---- one payment naming two invoices
    paste(H + "A-101,Ana,2026-07-01,100.00,H13,13.00,113.00\nA-102,Bo,2026-07-02,200.00,H13,26.00,226.00\n",
          "Date,Description,Amount\n2026-07-10,PAYMENT A-101 A-102,339.00\n2026-07-11,PAYMENT A-101 A-102,100.00\n")
    page.click("#btn-run")
    mt = page.inner_text("#matched"); ex = page.inner_text("#exceptions")
    check("payment naming two invoices with the exact combined balance pays both", "A-101" in mt and "A-102" in mt and "Invoice numbers in description" in mt, mt[:300])
    check("second payment naming two paid invoices goes to review", "Needs review" in ex, ex[:300])
    # ---- signed amount column, same sample data
    bank = rcsv(os.path.join(ROOT, "bank.csv"))
    signed = "Posted date,Transaction details,Amount\n" + "".join(f'{r[0]},"{r[1]}",{("-" + r[2]) if r[2] else r[3]}\n' for r in bank[1:])
    paste(open(os.path.join(ROOT, "invoices.csv")).read(), signed)
    page.click("#btn-run")
    s = page.inner_text("#summary")
    check("bank file with one signed amount column gives the same result", "38 payments matched to 37 invoices" in s and "14 exceptions" in s, s)
    # ---- dates that can't be told apart must be chosen
    paste(H + "B-1,Ana,03/04/2026,100.00,H13,13.00,113.00\n", "Date,Description,Amount\n2026-04-10,INV B-1,113.00\n")
    page.click("#btn-run")
    check("undetectable date order blocks matching until chosen, with the column list opened", "Invoices: date order" in page.inner_text("#map-error") and page.evaluate("document.getElementById('map-details').open") is True)
    page.select_option("#o-inv", "month"); page.click("#btn-run")
    check("after choosing month first, it matches (and says '1 payment', not '1 payments')", "1 payment matched to 1 invoice" in page.inner_text("#summary"), page.inner_text("#summary"))
    # ---- total rule is exact to the cent
    paste(H + "T-1,Ana,2026-07-01,100.00,H13,13.00,113.01\nT-2,Bo,2026-07-01,100.00,EXEMPT,0.00,100.00\n", "Date,Description,Amount\n2026-07-05,INV T-1,113.01\n2026-07-05,INV T-2,100.00\n")
    page.click("#btn-run")
    ex = page.inner_text("#exceptions")
    check("total one cent off is flagged; a correct EXEMPT invoice is not", "Total doesn't add up" in ex and "T-1" in ex and "T-2" not in ex, ex[:300])
    # ---- money formats
    cases = page.evaluate("""[['$1,234.56',123456],['1 234,56',123456],['(45.00)',-4500],['-12.5',-1250],['CA$ 99.99',9999],['1.234,56',123456],['abc',null],['',null],['12.345',null]].map(([s,v]) => [s, Recon.parseMoney(s), v])""")
    check("money parsing: $, commas, French format, brackets, bad values", all(a == b for _, a, b in cases), cases)
    # ---- bad rows and file errors
    paste(H + "C-1,Ana,2026-07-01,100.00,H13,13.00,abc\nC-2,Bo,2026-07-01,100.00,H13,13.00,113.00\nC-2,Bo,2026-07-02,1.00,H13,0.13,1.13\n,No number,2026-07-01,1,H13,0.13,1.13\n",
          "Date,Description,Amount\n2026-07-05,INV C-2,113.00\nnot a date,X,5.00\n")
    page.click("#btn-run")
    sk = page.inner_text("#skipped") if page.is_visible("#skipped-wrap") else ""
    check("unreadable rows are listed, not silently dropped (4 rows)", sk.count("Invoices") + sk.count("Bank") >= 4 and "already appears" in sk and "isn't a number" in sk, sk)
    paste("", "Date,Description,Amount\n")
    check("empty invoices file: clear error", "invoices file is empty" in page.inner_text("#load-error"))
    paste(H, "Date,Description,Amount\n2026-07-05,X,1.00\n")
    check("header only: clear error", "no data rows" in page.inner_text("#load-error"))
    paste(H + '"A-1,Ana,2026-07-01,100,H13,13,113\n', "Date,Description,Amount\n2026-07-05,X,1.00\n")
    check("unclosed quote: error names the file and line", "invoices file, line 2" in page.inner_text("#load-error"), page.inner_text("#load-error"))
    paste("Foo,Bar\n1,2\n", "Date,Description,Amount\n2026-07-05,X,1.00\n")
    page.click("#btn-run")
    check("missing required columns: says which ones", "Invoices: Invoice number" in page.inner_text("#map-error"), page.inner_text("#map-error"))

    # ---- large: 5,000 invoices and 5,000 payments
    R = random.Random(3); ib = io.StringIO(); bb = io.StringIO()
    ib.write(H); bb.write("Date,Description,Amount\n")
    used = set()
    for k in range(5000):
        sub = 10000 + k * 7 + R.randint(0, 5)
        tax = (sub * 13 + 50) // 100; tot = sub + tax
        d = 1 + k % 28
        ib.write(f"INV-{20000+k},Customer {k},2026-07-{d:02d},{sub/100:.2f},H13,{tax/100:.2f},{tot/100:.2f}\n")
        desc = f"PAYMENT INV-{20000+k}" if k % 50 else "E-TRANSFER RECEIVED"
        bb.write(f"2026-08-{d:02d},{desc},{tot/100:.2f}\n")
    open("/tmp/inv5k.csv", "w").write(ib.getvalue()); open("/tmp/bank5k.csv", "w").write(bb.getvalue())
    if page.is_visible("#btn-reset"): page.click("#btn-reset")
    page.set_input_files("#file-inv", "/tmp/inv5k.csv"); page.wait_for_selector("#inv-status:has-text('5000 rows')")
    page.set_input_files("#file-bank", "/tmp/bank5k.csv"); page.wait_for_selector("#bank-status:has-text('5000 rows')")
    t0 = time.time(); page.click("#btn-run"); page.wait_for_selector("#step-results:not([hidden])"); t1 = time.time()
    s = page.inner_text("#summary")
    print(f"      timing: 5,000 x 5,000 match and render {t1-t0:.2f}s")
    check("5,000 invoices x 5,000 payments: all matched, no exceptions", "5000 payments matched to 5000 invoices" in s and "0 exceptions" in s, s)
    check("5,000 x 5,000 under 3 seconds", t1 - t0 < 3, t1 - t0)

    # ---- CSP and blocked network
    csp = page.get_attribute('meta[http-equiv="Content-Security-Policy"]', "content") or ""
    check("CSP: script hash only, connect-src 'none'", "script-src 'sha256-" in csp and "connect-src 'none'" in csp, csp)
    net = ctx.new_page(); net.goto(URL); net.wait_for_selector("#btn-sample")
    check("page cannot send data out (fetch blocked)", net.evaluate("fetch('https://example.com/x',{method:'POST',body:'x'}).then(() => 'sent', () => 'blocked')") == "blocked")
    net.close()

    # ---- injection through file contents
    pinv = H + '"<img src=x onerror=window.__pwned=1>","<script>window.__pwned=2</script>",2026-07-01,100.00,"<b>H13</b>",13.00,113.00\n'
    pbank = 'Date,"<svg onload=window.__pwned=3>",Amount\n2026-07-05,"x\' onmouseover=\'window.__pwned=4 <img src=x onerror=window.__pwned=5>",113.00\n'
    for bypass in (True, False):
        c2 = br.new_context(viewport={"width": 390, "height": 844}, bypass_csp=bypass); c2.route("**/fonts.g*/**", lambda r: r.abort())
        p2 = c2.new_page(); p2.goto(URL); p2.wait_for_selector("#btn-sample")
        p2.evaluate("document.getElementById('paste-box').open = true")
        p2.fill("#paste-inv", pinv); p2.fill("#paste-bank", pbank); p2.click("#btn-paste")
        p2.select_option("#r-bank-desc", "1"); p2.click("#btn-run"); p2.wait_for_selector("#step-results:not([hidden])")
        p2.hover("#exceptions"); p2.hover("#matched"); p2.wait_for_timeout(300)
        shown = p2.inner_text("main")
        check(f"injection payloads render as text and never run ({'CSP bypassed' if bypass else 'CSP on'})", p2.evaluate("window.__pwned") is None and "<img src=x" in shown, shown[:200])
        c2.close()


    # ---- files shaped like real exports (fixtures in /home/claude/fixtures)
    FX = "/home/claude/fixtures/"
    def load_pair(inv_file, bank_file):
        if page.is_visible("#btn-reset"): page.click("#btn-reset")
        page.set_input_files("#file-inv", FX + inv_file); page.wait_for_selector(f"#inv-status:has-text('{inv_file}')")
        page.set_input_files("#file-bank", FX + bank_file); page.wait_for_selector(f"#bank-status:has-text('{bank_file}')")
        summ = page.inner_text("#map-summary"); opened = page.evaluate("document.getElementById('map-details').open")
        page.click("#btn-run"); page.wait_for_selector("#step-results:not([hidden])")
        return summ, opened, page.inner_text("#summary")
    SAME = "38 payments matched to 37 invoices"
    summ, opened, res = load_pair("sample-invoices.csv", "bank-rbc-style.csv")
    check("RBC layout (CAD$ column, reference in Description 2): same 38 matches and 14 exceptions as the sample", SAME in res and "14 exceptions" in res, res)
    summ, opened, res = load_pair("sample-invoices.csv", "bank-td-style.csv")
    check("TD layout (no header row, running balance): noticed, list opened, same result", "no header row" in summ and opened and SAME in res and "14 exceptions" in res, (summ, res))
    summ, opened, res = load_pair("sample-invoices.csv", "bank-french-style.csv")
    check("French style (Montant, '3 503,28', '11 juin 2026'): same result, dates described correctly", SAME in res and "14 exceptions" in res and "month names" in summ, (summ, res))
    summ, opened, res = load_pair("invoices-report-style.csv", "sample-bank.csv")
    sk = page.inner_text("#skipped") if page.is_visible("#skipped-wrap") else ""
    check("report-style invoices (title lines, totals row, no tax columns): title lines skipped, totals row listed, tax checks skipped",
          "Skipped 3 title lines" in summ and "no subtotal or tax column" in summ and "Totals row, left out" in sk and SAME in res and "10 exceptions" in res and "Tax and total checks were skipped" in res, (summ, res, sk))

    # ---- manual matching
    page.click("#btn-reset"); page.click("#btn-sample"); page.click("#btn-run"); page.wait_for_selector("#step-results:not([hidden])")
    page.select_option("#mm-35", "INV-1037"); page.click('[data-manual="35"]')
    ex = grab(page, "#dl-exc"); c3 = Counter(TYPE_OF[r[0]] for r in ex[1:])
    mt = grab(page, "#dl-matched")
    hand = [r for r in mt[1:] if r[6] == "Matched by hand"]
    check("hand match: row 35 to INV-1037 makes it partly paid; unmatched 3 to 2, unpaid 3 to 2, partial 2 to 3 (13 exceptions)",
          c3["unmatched"] == 2 and c3["unpaid"] == 2 and c3["partial"] == 3 and len(ex) - 1 == 13 and len(hand) == 1 and hand[0][0] == "INV-1037" and hand[0][1] == "Partly paid", (c3, hand))
    check("summary says 1 payment was matched by hand", "1 payment was matched by hand" in page.inner_text("#summary"))
    check("hand match listed under Exceptions with its own Undo", page.is_visible('#hand [data-unmatch="35"]') and "Bank row 35 to INV-1037" in page.inner_text("#hand"))
    page.click('#hand [data-unmatch="35"]')
    ex = grab(page, "#dl-exc")
    check("undo restores the original 14 exceptions", len(ex) - 1 == 14 and "matched by hand" not in page.inner_text("#summary"))
    opts = page.eval_on_selector_all("#mm-35 option", "o => o.map(x => x.value)")
    check("hand-match list offers only invoices with money owing", "INV-1001" not in opts and "INV-1037" in opts and len(opts) == 5, opts)

    # ---- first screen and sample downloads
    page.set_viewport_size({"width": 375, "height": 667}); page.goto(URL); page.wait_for_selector("#btn-sample")
    check("Load sample data is on the first screen at 375 x 667", page.evaluate("document.getElementById('btn-sample').getBoundingClientRect().bottom") <= 667)
    si = grab(page, "#dl-sample-inv"); sb = grab(page, "#dl-sample-bank")
    check("sample downloads: 40 invoices and 48 bank lines", len(si) == 41 and len(sb) == 49)
    page.set_viewport_size({"width": 390, "height": 844})
    # ---- focus and desktop
    page.focus("#btn-sample"); page.keyboard.press("Tab"); page.keyboard.press("Shift+Tab")
    check("keyboard focus shows a 3px outline", page.evaluate("getComputedStyle(document.activeElement).outlineWidth") == "3px")
    page.set_viewport_size({"width": 1360, "height": 900})
    if page.is_visible("#btn-reset"): page.click("#btn-reset")
    page.click("#btn-sample"); page.click("#btn-run"); page.wait_for_selector("#step-results:not([hidden])")
    check("no sideways page scroll at 1360px", page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 0)
    page.screenshot(path=os.path.join(ROOT, "shots", "d2-1360-results.png"), full_page=True)
    check("no console or page errors", not errors, errors)
    br.close()
srv.terminate()
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
