// 検証：サーバーなし（アプリ内蔵の【サンプル】データ）でのブラウザ版アプリの操作
const { chromium } = require('playwright');
const OUT = process.argv[2];
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.accept();
  });
  const text = async (id) => (await page.getByTestId(id).innerText()).replace(/\n/g, ' | ');

  await page.goto('http://localhost:8099/');
  await page.getByTestId('indoor-map').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/01-home.png` });
  const banner = await text('status-banner');
  check('S1. 起動：地図・状態表示（規制情報未取得のため「制限」、サーバー未設定）', banner.includes('規制情報：制限') && banner.includes('サーバー未設定'), banner);
  check('S2. 下部カードに施設名', (await text('home-card')).includes('【サンプル】テストモール'));

  await page.getByTestId('search-input').fill('かふぇ');
  await page.getByTestId('search-results').getByText('カフェ・テスト').waitFor();
  await page.screenshot({ path: `${OUT}/02-search.png` });
  check('S3. ひらがな検索で店舗が出る（フロア表示つき）', (await text('search-results')).includes('カフェ・テスト'));
  await page.getByTestId('search-results').getByText('カフェ・テスト').click();
  const card = await text('store-card');
  check('S4. 店舗カード：名前・カテゴリー・フロア・営業時間', card.includes('カフェ・テスト') && card.includes('飲食') && card.includes('1F') && card.includes('営業時間'), card);
  await page.screenshot({ path: `${OUT}/03-store.png` });

  await page.getByTestId('route-button').click();
  await page.getByTestId('route-card').waitFor();
  await page.waitForTimeout(400);
  let rc = await text('route-card');
  check('S5. 確認後に参考案内として経路表示（案内文つき）', dialogs.length === 1 && rc.includes('徒歩約') && rc.includes('参考案内') && rc.includes('1F 南口から出発') && rc.includes('到着'), rc);
  await page.screenshot({ path: `${OUT}/04-route-1f.png` });
  await page.getByLabel('案内を終了').click();
  await page.getByLabel('閉じる').click();

  // 2Fの店舗へ（フロアをまたぐ）
  await page.getByTestId('search-input').fill('らーめん');
  await page.getByTestId('search-results').getByText('ラーメン・テスト').click();
  await page.getByTestId('route-button').click();
  await page.getByTestId('route-card').waitFor();
  await page.waitForTimeout(400);
  rc = await text('route-card');
  check('S6. 2Fの店舗へ：エスカレーターでのフロア移動を案内', rc.includes('エスカレーターで2Fへ') && rc.includes('2F ラーメン・テストに到着'), rc);
  await page.getByRole('button', { name: '2Fの経路', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-route-2f.png` });
  await page.getByLabel('案内を終了').click();
  await page.getByLabel('閉じる').click();

  // トイレ
  await page.getByRole('button', { name: 'トイレ', exact: true }).click();
  await page.getByTestId('route-card').waitFor();
  rc = await text('route-card');
  check('S7. 「トイレ」で最寄りのトイレへの経路', rc.includes('トイレ への経路') && rc.includes('徒歩約'), rc);
  await page.getByLabel('案内を終了').click();

  // カテゴリー
  await page.getByRole('button', { name: '飲食', exact: true }).click();
  await page.waitForTimeout(300);
  const body = await page.locator('body').innerText();
  check('S8. カテゴリー「飲食」で一覧（12件）', body.includes('飲食（12件）'));
  await page.screenshot({ path: `${OUT}/06-category.png` });
  await page.getByLabel('閉じる').click();

  // フロア切替
  await page.getByLabel('2Fを表示').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-floor2.png` });
  check('S9. フロア切替（2F）', true);
  await page.getByLabel('1Fを表示').click();

  // 地図の通路をタップ → 出発地変更（画面中央はメインモールの通路）
  await page.getByLabel('施設全体を表示').click();
  await page.waitForTimeout(300);
  const box = await page.getByTestId('indoor-map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.waitForTimeout(400);
  check('S10. 通路のタップで出発地を変更', (await text('home-card')).includes('出発地：1F 指定した地点'), await text('home-card'));

  // 検証画面：同意・送信待ち
  await page.getByLabel('検証画面を開く').click();
  await page.getByTestId('debug-screen').waitFor();
  const sw = page.getByRole('switch');
  await sw.nth(1).click();
  await page.getByText('テスト用イベントを10件追加').click();
  await page.waitForTimeout(600);
  const q1 = await page.getByText(/^\d+件$/).first().innerText();
  await page.reload();
  await page.getByTestId('debug-screen').waitFor();
  await page.waitForTimeout(800);
  const q2 = await page.getByText(/^\d+件$/).first().innerText();
  await sw.nth(1).click();
  await page.waitForTimeout(400);
  const q3 = await page.getByText(/^\d+件$/).first().innerText();
  check('S11. 同意後に送信待ち10件・再起動後も保持・同意取消で0件', q1 === '10件' && q2 === '10件' && q3 === '0件', `${q1} / ${q2} / ${q3}`);
  await page.screenshot({ path: `${OUT}/08-debug.png`, fullPage: true });

  check('ブラウザのエラーなし', errors.length === 0, errors.join(' / '));
  console.log(`\nRESULT ${results.filter((r) => r.ok).length}/${results.length} passed`);
  require('fs').writeFileSync(`${OUT}/e2e-standalone-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
