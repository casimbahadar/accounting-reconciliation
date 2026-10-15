# Invoice and bank reconciliation (demo)

A browser tool that matches bank deposits to invoices and lists everything that needs a person to look at it. It is a demo with made-up sample data.

Live: https://casimbahadar.github.io/accounting-reconciliation/

## What it does

- Reads an invoices CSV and a bank statement CSV. The bank file can have one signed amount column or separate deposit and withdrawal columns, with or without a header row. Withdrawals are left out.
- Handles the layouts of RBC exports (a signed CAD$ column, with the payer and reference split across Description 1 and Description 2) and TD exports (no header row: date, description, withdrawal, deposit, balance). With no header row, columns are worked out from what's in them and shown for a person to check.
- Skips title lines above the header and totals rows in report-style exports. If the invoices file has no subtotal or tax column, the tax checks are skipped and the page says so.
- Matches a payment to an invoice when the bank description names the invoice number (INV-1042, INV1042, #1042 or "invoice 1042"), whatever the date.
- Matches a payment with no invoice number when exactly one open invoice has that balance and is dated within a set number of days before the payment (45 by default). When two or more invoices fit, it lists the payment as "Needs review" instead of guessing.
- Flags payments with no invoice, invoices with no payment, partly paid invoices, duplicate payments and overpayments.
- Checks 13% HST on invoices with tax code H13, allowing one cent for rounding. Flags EXEMPT and ZERO invoices that charge any tax. If the file has no tax code column, every invoice is treated as H13.
- Checks that subtotal plus tax equals the total on every invoice, to the cent.
- Works out whether dates are day first or month first from the file, and asks when it can't tell.
- Reads amounts written as $1,234.56, 1 234,56, (45.00) or -45.00, and dates with English or French month names.
- Any payment left over can be matched to an open invoice by hand. The whole reconciliation reruns, so partial payments and totals stay right, and each hand match can be undone.

Downloads: the exceptions list and the matched list, both as CSV. Every exception says why it was flagged. The page also offers the two sample files.

## Privacy

Everything runs in your browser. Files are read on your device, and the page's Content-Security-Policy blocks it from sending data anywhere. The only outside request is for the Schibsted Grotesk font from Google Fonts.

## Sample data

40 invoices and 48 bank lines for a made-up small business. Every name, number and amount is invented. The tool is tested to find exactly these planted problems and nothing else:

- 3 payments with no invoice, 3 invoices with no payment, 2 partly paid invoices, 2 duplicate payments, 2 invoices where the tax isn't 13%, 1 ZERO invoice that charges tax, 1 invoice whose total is $10.00 more than subtotal plus tax
- 38 payments matched to 37 invoices, 4 of them by amount and date because they name no invoice
- Cases that must not be flagged: 5 withdrawals, an invoice paid in two instalments, two invoices with the same total told apart by their numbers, a payment 70 days late that names its invoice, a one-cent rounding difference, and EXEMPT and ZERO invoices that charge no tax

## Files

- `index.html` is the whole tool. The CSS and JavaScript are inline and there is no build step.
- `.nojekyll` tells GitHub Pages to serve the files as they are.

Built by Casim Bahadar, Kitchener-Waterloo, Ontario. https://casimbahadar.github.io/
