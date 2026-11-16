const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  const step = (s) => console.log('STEP', s);

  await page.goto('http://localhost:8099/');
  await page.getByText('【サンプル】テストモール').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/01-map.png` });
  step('map ok; banner=' + (await page.getByTestId('status-banner').innerText()).replace(/\n/g, ' | '));

  await page.getByTestId('search-input').fill('かふぇ');
  await page.getByText('カフェ・テスト').first().waitFor();
  await page.screenshot({ path: `${out}/02-search.png` });
  step('search ok');
  await page.getByText('カフェ・テスト').first().click();
  await page.getByTestId('store-card').waitFor();
  step('card: ' + (await page.getByTestId('store-card').innerText()).replace(/\n/g, ' | '));
  await page.getByTestId('route-button').click();
  await page.getByText(/徒歩約/).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/03-route.png` });
  step('route: ' + (await page.getByTestId('store-card').innerText()).replace(/\n/g, ' | '));
  step('dialogs: ' + JSON.stringify(dialogs));

  // 地図上の店舗Hをタップ（地図の右下付近）→ 店舗カードが切り替わる
  const box = await page.getByTestId('indoor-map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.62);
  await page.waitForTimeout(400);
  step('after tap store: ' + (await page.getByTestId('store-card').innerText().catch(() => 'no card')).split('\n')[0]);
  // 通路（中央の横通路）をタップ → 出発地が変わる
  await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.5);
  await page.waitForTimeout(400);
  step('start label: ' + (await page.getByText(/出発地：/).innerText()));
  await page.screenshot({ path: `${out}/04-tap.png` });

  await page.getByText('検証', { exact: true }).click();
  await page.getByTestId('debug-screen').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/05-debug.png`, fullPage: true });
  step('debug ok');
  const sw = page.getByRole('switch');
  step('switch count: ' + (await sw.count()));
  // 2番目のスイッチ = 分析データ同意
  await sw.nth(1).click();
  await page.getByText('テスト用イベントを10件追加').click();
  await page.waitForTimeout(800);
  step('outbox: ' + (await page.getByText(/^\d+件$/).first().innerText()));
  await page.reload();
  await page.getByTestId('debug-screen').waitFor();
  await page.waitForTimeout(800);
  step('after reload outbox: ' + (await page.getByText(/^\d+件$/).first().innerText()) + ' consent=' + (await sw.nth(1).isChecked()));
  await sw.nth(1).click(); // 同意を取り消す → 未送信データ削除
  await page.waitForTimeout(500);
  step('after revoke outbox: ' + (await page.getByText(/^\d+件$/).first().innerText()));
  // 時刻を+7時間 → 規制情報未取得のまま（制限）
  await page.getByText('+7時間').click();
  await page.waitForTimeout(300);
  step('judge: ' + (await page.getByText(/^(正常|注意|制限)（/).innerText()));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
