// Runs the avoid-ai-ui-tells audit on the start, columns and results states.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const exe = require('child_process').execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome').toString().trim();
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const audit = fs.readFileSync('/mnt/skills/plugins/avoid-ai-ui-tells/scripts/ui-tell-audit.js', 'utf8').replace(/^\s*\/\/.*\n/gm, '');
  for (const w of [390, 320, 1280]) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2 });
    await page.route(/fonts\.g/, r => r.abort());
    await page.goto(process.argv[2]);
    await page.click('#btn-sample'); await page.click('#btn-run');
    await page.evaluate(() => { document.getElementById('paste-box').open = true; });
    await page.waitForTimeout(300);
    const r = await page.evaluate('(' + audit + ')()');
    console.log('\n=== results state @' + w + 'px === slop categories: ' + r.slopCount + ' -> ' + r.verdict);
    r.findings.forEach(x => console.log('  SLOP    ' + x.id + ': ' + x.detail));
    r.quality.forEach(x => console.log('  QUALITY ' + x.id + ': ' + JSON.stringify(x.detail)));
    await page.close();
  }
  await browser.close();
})();
