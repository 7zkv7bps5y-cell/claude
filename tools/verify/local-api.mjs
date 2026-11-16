// 検証用：Supabase の公開API（PostgREST の /rest/v1/rpc/*）を模した最小サーバー。
// 匿名ロール（anon）で関数を実行するので、本番と同じ権限で動作確認できる。
// /__mode?m=up|down|drop で「通常 / 通信不可 / 保存後に応答を切断」を切り替える。
import http from 'node:http';
import pg from 'pg';

const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.VERIFY_PGPORT ?? 55433), user: 'postgres', database: 'postgres' });
const KEY = 'sb_publishable_test';
const FUNCS = {
  get_facility_version: ['p_facility_id'],
  get_published_facility: ['p_facility_id'],
  get_active_route_rules: ['p_facility_id'],
  ingest_events: ['p_events'],
};
let mode = 'up';
let drops = 0;
const log = [];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__mode') {
      mode = url.searchParams.get('m');
      if (mode === 'drop') drops = 3; // ブラウザの自動再試行も含めて3回、保存後に切断する
      res.writeHead(200, cors).end(mode);
      return;
    }
    if (url.pathname === '/__log') {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(log));
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (mode === 'down') {
      req.socket.destroy();
      return;
    }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (!m || !FUNCS[m[1]]) {
      res.writeHead(404, cors).end('not found');
      return;
    }
    if (req.headers.apikey !== KEY) {
      res.writeHead(401, cors).end('bad key');
      return;
    }
    let body = '';
    for await (const c of req) body += c;
    const args = JSON.parse(body || '{}');
    const names = FUNCS[m[1]];
    const sql = `select public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await client.query('set local role anon');
      const r = await client.query(sql, names.map((n) => (n === 'p_events' ? JSON.stringify(args[n]) : args[n])));
      await client.query('commit');
      log.push({ fn: m[1], n: m[1] === 'ingest_events' ? args.p_events.length : undefined });
      if (mode === 'drop' && m[1] === 'ingest_events') {
        if (--drops <= 0) mode = 'up'; // 保存はしたが応答を返さずに切断
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(r.rows[0].r));
    } catch (e) {
      await client.query('rollback').catch(() => {});
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ message: e.message }));
    } finally {
      client.release();
    }
  })
  .listen(8098, () => console.log('api on 8098'));
