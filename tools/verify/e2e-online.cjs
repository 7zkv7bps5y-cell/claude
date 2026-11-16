// 検証：サーバー接続ありのアプリ動作（オフライン保存・規制・鮮度・送信キュー・重複防止・版更新）
const { chromium } = require('playwright');
const pg = require('pg');
const OUT = process.argv[2];
const APP = 'http://localhost:8097/';
const API = 'http://localhost:8098';
const FAC = '00000000-0000-4000-8000-000000000001';
const db = new pg.Client({ host: '127.0.0.1', port: Number(process.env.VERIFY_PGPORT ?? 55433), user: 'postgres', database: 'postgres' });
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const setMode = (m) => fetch(`${API}/__mode?m=${m}`);
const eventCount = async () => Number((await db.query('select count(*) from analytics_events')).rows[0].count);

(async () => {
  await db.connect();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const banner = async () => (await page.getByTestId('status-banner').innerText()).replace(/\n/g, ' | ');
  const gotoDebug = async () => {
    await page.getByText('検証', { exact: true }).click();
    await page.getByTestId('debug-screen').waitFor();
  };
  const back = async () => {
    await page.goBack();
    await page.getByTestId('indoor-map').waitFor();
  };
  const refreshNow = async () => {
    await gotoDebug();
    await page.getByText('今すぐ更新を確認').click();
    await page.waitForTimeout(1200);
    const info = await page.getByText(/^(通信成功|通信なし)／/).innerText();
    await back();
    return info;
  };
  const routeTo = async (name) => {
    await page.getByTestId('search-input').fill(name);
    await page.getByText(name).first().click();
    await page.getByTestId('route-button').click();
    await page.waitForTimeout(500);
    return (await page.getByTestId('store-card').innerText()).replace(/\n/g, ' | ');
  };
  const closeCard = async () => page.getByLabel('閉じる').click();

  // 1) 初回起動：サーバーから取得して端末に保存
  await page.goto(APP);
  await page.getByTestId('indoor-map').waitFor();
  await page.waitForTimeout(1500);
  let b = await banner();
  check('1. 起動時にサーバーから地図・規制情報を取得し「最新」表示', b.includes('規制情報：最新') && b.includes('第1版'), b);
  await page.screenshot({ path: `${OUT}/10-online.png` });

  // 2) 通行止めを追加 → 更新 → 経路に反映
  let card = await routeTo('ファッション・デモ');
  check('2a. 規制なしでは西口→ファッション・デモの経路が出る', card.includes('徒歩約') && !card.includes('参考案内'), card);
  await closeCard();
  await db.query(`insert into route_rules (facility_id, kind, severity, edge_ids, note) values ($1, 'closed', 'normal', '{e011}', '【テスト】通行止め')`, [FAC]);
  await refreshNow();
  card = await routeTo('ファッション・デモ');
  check('2b. 通行止め（公開操作なし）が即時反映され、経路なしと案内', card.includes('通行できる経路が見つかりません'), card);
  await page.screenshot({ path: `${OUT}/11-closed.png` });
  await closeCard();

  // 3) 期間つきの一時封鎖（開始前）→ オフラインのまま時刻経過で自動適用
  await db.query(`delete from route_rules`);
  await db.query(
    `insert into route_rules (facility_id, kind, severity, edge_ids, starts_at, ends_at) values ($1, 'temporary_closure', 'normal', '{e011}', now() + interval '20 minutes', now() + interval '3 hours')`,
    [FAC],
  );
  await refreshNow();
  await setMode('down');
  card = await routeTo('ファッション・デモ');
  check('3a. 開始前の一時封鎖は適用されない', card.includes('徒歩約'), card);
  await closeCard();
  await gotoDebug();
  await page.getByText('+30分').click();
  await back();
  card = await routeTo('ファッション・デモ');
  check('3b. オフラインでも開始時刻を過ぎた一時封鎖は端末内で自動適用', card.includes('通行できる経路が見つかりません'), card);
  b = await banner();
  check('3c. 最終取得から30分経過で「注意」＋最終取得日時を表示', b.includes('規制情報：注意') && b.includes('最終取得'), b);
  await closeCard();
  await gotoDebug();
  await page.getByText('+7時間').click();
  await back();
  card = await routeTo('ファッション・デモ');
  b = await banner();
  check('3d. 7時間後：期限切れの封鎖は自動解除、鮮度は「制限」で参考案内', card.includes('徒歩約') && card.includes('参考案内') && b.includes('規制情報：制限'), `${b} || ${card}`);
  await page.screenshot({ path: `${OUT}/12-restricted.png` });
  await closeCard();

  // 4) オフラインで再起動しても地図・検索・経路が使える（端末保存データ）
  await page.reload();
  await page.getByTestId('indoor-map').waitFor();
  await page.waitForTimeout(1500);
  b = await banner();
  check('4a. 通信不可で再起動しても保存済みデータで地図表示（オフライン表示）', b.includes('オフライン') && b.includes('第1版'), b);
  card = await routeTo('和食処ためし');
  check('4b. オフラインで検索・経路案内ができる', card.includes('徒歩約'), card);
  await closeCard();

  // 5) 安全上重要な規制（severity=high）は早く「制限」になる
  await setMode('up');
  await gotoDebug();
  await page.getByText('現在', { exact: true }).click();
  await back();
  await db.query(`delete from route_rules`);
  await db.query(`insert into route_rules (facility_id, kind, severity, edge_ids, note) values ($1, 'closed', 'high', '{e029}', '【テスト】重要')`, [FAC]);
  await refreshNow();
  await gotoDebug();
  await page.getByText('+2時間').click();
  const judge = await page.getByText(/^(正常|注意|制限)（/).innerText();
  check('5. 重要度「高」の規制を保存している場合、2時間で「制限」', judge.startsWith('制限'), judge);
  await page.getByText('現在', { exact: true }).click();

  // 6) 施設ごとのしきい値変更（block）が規制情報と一緒に配信される
  await db.query(`update facilities set rule_restrict_mode = 'block' where id = $1`, [FAC]);
  await page.getByText('今すぐ更新を確認').click();
  await page.waitForTimeout(1000);
  await page.getByText('+7時間').click();
  const judge2 = await page.getByText(/^(正常|注意|制限)（/).innerText();
  check('6. 施設の設定を「案内停止」に変えると、古い場合は経路案内を停止', judge2.includes('停止'), judge2);
  await page.getByText('現在', { exact: true }).click();
  await db.query(`update facilities set rule_restrict_mode = 'confirm' where id = $1`, [FAC]);
  await db.query(`delete from route_rules`);

  // 7) 行動データ：同意なしでは送らない → 同意 → 送信
  const before = await eventCount();
  await page.getByText('今すぐ送信').click();
  await page.waitForTimeout(500);
  check('7a. 同意しない（初期値）間は行動データを送信しない', (await eventCount()) === before, `DB=${await eventCount()}`);
  await page.getByRole('switch').nth(1).click();
  await page.getByText('テスト用イベントを10件追加').click();
  await page.waitForTimeout(300);
  await page.getByText('今すぐ送信').click();
  await page.waitForTimeout(1000);
  check('7b. 同意後は送信され、サーバーに10件保存', (await eventCount()) === before + 10, `DB=${await eventCount()}`);

  // 8) 通信不可の間は端末に保存 → 復旧後に送信
  await setMode('down');
  await page.getByText('テスト用イベントを10件追加').click();
  await page.waitForTimeout(300);
  await page.getByText('今すぐ送信').click();
  await page.waitForTimeout(1500);
  const pending = await page.getByText(/^\d+件$/).first().innerText();
  check('8a. 通信不可の間は送信待ちとして端末に残る', pending === '10件' && (await eventCount()) === before + 10, `送信待ち=${pending}`);
  await setMode('up');
  await page.reload(); // 再起動しても送信待ちは消えない
  await page.getByTestId('debug-screen').waitFor();
  await page.waitForTimeout(1500);
  await page.getByText('今すぐ送信').click();
  await page.waitForTimeout(1200);
  check('8b. 再起動後も送信待ちが残り、通信復旧後に送信される', (await eventCount()) === before + 20, `DB=${await eventCount()}`);

  // 9) 保存後に応答が切れても、再送で重複しない
  await page.getByText('テスト用イベントを10件追加').click();
  await page.waitForTimeout(300);
  await setMode('drop');
  await page.getByText('今すぐ送信').click();
  await page.waitForTimeout(1500);
  const ingestCalls = (await (await fetch(`${API}/__log`)).json()).filter((l) => l.fn === 'ingest_events').length;
  const afterDrop = await eventCount();
  const pending2 = await page.getByText(/^\d+件$/).first().innerText();
  await page.reload(); // 再送待ちを解除するため再起動
  await page.getByTestId('debug-screen').waitFor();
  await page.waitForTimeout(1500);
  await page.getByText('今すぐ送信').click();
  await page.waitForTimeout(1200);
  const afterRetry = await eventCount();
  check(
    '9. サーバー保存後に応答が切れて再送しても重複しない',
    afterDrop === before + 30 && pending2 === '10件' && afterRetry === before + 30,
    `切断時DB=${afterDrop} 端末残=${pending2} 再送後DB=${afterRetry} 受付呼出累計=${ingestCalls}`,
  );

  // 10) 新しい版の公開 → 更新。壊れた版は保存しない
  const snap = (await db.query(`select snapshot from map_versions where facility_id = $1 and version_no = 1`, [FAC])).rows[0].snapshot;
  snap.version.versionNo = 2;
  snap.stores.find((s) => s.id === 'store-B').name = 'カフェ・テスト（改装後）';
  await db.query(`update map_versions set status = 'archived' where facility_id = $1`, [FAC]);
  await db.query(`insert into map_versions (facility_id, version_no, status, snapshot) values ($1, 2, 'published', $2)`, [FAC, snap]);
  await page.getByText('今すぐ更新を確認').click();
  await page.waitForTimeout(1200);
  await back();
  b = await banner();
  await page.getByTestId('search-input').fill('かふぇ');
  const hit = await page.getByTestId('search-results').innerText();
  check('10a. 新しい版（第2版）を取得し、店舗名の変更が反映', b.includes('第2版') && hit.includes('改装後'), `${b} || ${hit}`);
  await page.getByTestId('search-input').fill('');
  await db.query(`update map_versions set status = 'archived' where facility_id = $1`, [FAC]);
  await db.query(`insert into map_versions (facility_id, version_no, status, snapshot) values ($1, 3, 'published', '{"schemaVersion":1,"broken":true}')`, [FAC]);
  await gotoDebug();
  await page.getByText('今すぐ更新を確認').click();
  await page.waitForTimeout(1200);
  const info = await page.getByText(/^(通信成功|通信なし)／/).innerText();
  await back();
  b = await banner();
  check('10b. 壊れた版は保存せず、第2版のまま動作', info.includes('形式不正') && b.includes('第2版'), `${info} || ${b}`);
  await gotoDebug();
  await page.getByText('直前の版に戻す').click();
  await page.waitForTimeout(500);
  await back();
  b = await banner();
  check('10c. 直前の版（第1版）に戻せる', b.includes('第1版'), b);

  check('ブラウザのエラーなし', errors.length === 0, errors.join(' / '));
  console.log(`\nRESULT ${results.filter((r) => r.ok).length}/${results.length} passed`);
  require('fs').writeFileSync(`${OUT}/e2e-online-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  await db.end();
})().catch(async (e) => {
  console.error('ERROR', e);
  process.exit(1);
});
