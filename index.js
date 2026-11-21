/**
 * 大肥鱼 · 深海终端 —— 宿主那一半。
 *
 * 三件事：
 *   1. 给 `webserver/index-inject` 贡献一行 inline script（引导脚本），它在页面加载时
 *      把 /dbf/theme.css 与 /dbf/theme.js 拉进来并热轮询——所以之后改样式/逻辑只需要
 *      刷新页面，甚至不用刷新。
 *   2. 用带 Range 的路由供给背景素材（poster / 循环视频）。
 *   3. 一份极小遥测（CPU / 内存 / 运行时长）给 HUD 数字用。
 *
 * 注入表是宿主启动时收集一次的，所以订阅必须在 apply 第一件事同步注册；任何一步
 * 出错都只 warn，不往上抛（插件不能连累宿主启动）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'bigfatfish-theme';
export const inject = [];

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(ROOT, 'assets');
const PREFIX = '/dbf';

const POSTER_CANDIDATES = ['bg-poster.jpg', 'bg-poster.png', 'wallpaper-1920x1080.png', 'wallpaper.png'];
const VIDEO_CANDIDATES = ['bg-loop.mp4', 'bg.mp4'];

function firstExisting(dir, names) {
  for (const entry of names) {
    const file = path.join(dir, entry);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function readAsset(name) {
  try {
    return fs.readFileSync(path.join(ASSETS, name), 'utf8');
  } catch {
    return null;
  }
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

/** 带 Range 的文件投递：视频可以边下边播、可以 seek。 */
function serveFile(req, res, file) {
  const stat = fs.statSync(file);
  const headers = {
    'Content-Type': contentType(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (match) {
      const start = match[1] === '' ? 0 : Number(match[1]);
      const end = match[2] === '' ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

function json(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** CPU 占用靠两次采样做差；第一次给 0，不编造数字。 */
function createCpuSampler() {
  let previous = os.cpus().map((cpu) => cpu.times);
  return () => {
    const current = os.cpus().map((cpu) => cpu.times);
    let idleDelta = 0;
    let totalDelta = 0;
    for (let i = 0; i < current.length; i += 1) {
      const a = previous[i] ?? current[i];
      const b = current[i];
      idleDelta += b.idle - a.idle;
      totalDelta += (b.user + b.nice + b.sys + b.idle + b.irq) - (a.user + a.nice + a.sys + a.idle + a.irq);
    }
    previous = current;
    if (totalDelta <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - idleDelta / totalDelta));
  };
}

export function apply(ctx) {
  const warn = (where, error) => {
    try {
      ctx.logger?.warn?.(`[${name}] ${where}: ${String(error)}`);
    } catch {
      /* 日志都失败就算了 */
    }
  };

  /* ① 注入行：必须同步注册（注入表只在宿主启动时收集一次）。 */
  ctx.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table)) return;
    try {
      const boot = readAsset('boot.js');
      if (!boot) {
        warn('boot.js', 'missing assets/boot.js');
        return;
      }
      table.push({ kind: 'script', placement: 'body', text: boot });
    } catch (error) {
      warn('index-inject', error);
    }
  });

  /* ② 路由 */
  const sampleCpu = createCpuSampler();
  const startedAt = Date.now();

  const safe = (label, fn) => (req, res) => {
    try {
      /* 页面源是 dsh-app://app，boot.js 会先试 http://127.0.0.1:19387，
         不补这个头就会被 CORS 挡掉，然后每次轮询都刷一堆错误 */
      res.setHeader('Access-Control-Allow-Origin', '*');
      fn(req, res);
    } catch (error) {
      warn(label, error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('theme route failed');
    }
  };

  ctx.inject(['webServer'], (child) => {
    child.effect(() => {
      const disposed = [];

      const textRoute = (route, asset, type) => child.webServer.register({
        kind: 'exact',
        path: route,
        handler: safe(route, (req, res) => {
          const text = readAsset(asset);
          if (text === null) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`missing assets/${asset}`);
            return;
          }
          const body = Buffer.from(text);
          res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
          });
          res.end(body);
        }),
      });

      disposed.push(textRoute(`${PREFIX}/theme.css`, 'theme.css', 'text/css; charset=utf-8'));
      disposed.push(textRoute(`${PREFIX}/theme.js`, 'theme.js', 'text/javascript; charset=utf-8'));
      disposed.push(textRoute(`${PREFIX}/boot.js`, 'boot.js', 'text/javascript; charset=utf-8'));

      /* 打点：页面里的每一步回报到这里，落成文件方便排查（不用开 devtools）。 */
      disposed.push(child.webServer.register({
        kind: 'prefix',
        path: `${PREFIX}/beacon`,
        handler: safe('beacon', (req, res) => {
          try {
            const url = new URL(req.url ?? '', 'http://localhost');
            const event = url.searchParams.get('e') ?? '?';
            fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
            fs.appendFileSync(path.join(ROOT, 'logs', 'beacon.log'), `${new Date().toISOString()} ${event}\n`);
          } catch (error) {
            warn('beacon-write', error);
          }
          res.writeHead(204);
          res.end();
        }),
      }));

      /* DOM 快照：页面把结构 POST 过来，落成文件给我"看"真实布局（不用 devtools）。 */
      disposed.push(child.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/dump`,
        handler: safe('dump', (req, res) => {
          const chunks = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', () => {
            try {
              fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
              fs.writeFileSync(path.join(ROOT, 'logs', 'dom.json'), Buffer.concat(chunks));
            } catch (error) {
              warn('dump-write', error);
            }
            res.writeHead(204);
            res.end();
          });
        }),
      }));

      /* 开屏配乐（可选素材：assets/boot.mp3） */
      disposed.push(child.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/boot.mp3`,
        handler: safe('boot.mp3', (req, res) => {
          const file = path.join(ASSETS, 'boot.mp3');
          if (!fs.existsSync(file)) {
            res.writeHead(404);
            res.end();
            return;
          }
          serveFile(req, res, file);
        }),
      }));

      disposed.push(child.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/manifest.json`,
        handler: safe('manifest', (req, res) => {
          const poster = firstExisting(ASSETS, POSTER_CANDIDATES);
          const video = firstExisting(ASSETS, VIDEO_CANDIDATES);
          json(res, {
            version: '0.2.0',
            poster: poster ? `${PREFIX}/poster.png` : null,
            video: video ? `${PREFIX}/bg.mp4` : null,
          });
        }),
      }));

      disposed.push(child.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/poster.png`,
        handler: safe('poster', (req, res) => {
          const poster = firstExisting(ASSETS, POSTER_CANDIDATES);
          if (!poster) {
            res.writeHead(404);
            res.end();
            return;
          }
          serveFile(req, res, poster);
        }),
      }));

      disposed.push(child.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/bg.mp4`,
        handler: safe('bg.mp4', (req, res) => {
          const video = firstExisting(ASSETS, VIDEO_CANDIDATES);
          if (!video) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('no video asset');
            return;
          }
          serveFile(req, res, video);
        }),
      }));

      disposed.push(child.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/telemetry.json`,
        handler: safe('telemetry', (req, res) => {
          const total = os.totalmem();
          const free = os.freemem();
          json(res, {
            cpu: Number(sampleCpu().toFixed(3)),
            mem: Number((1 - free / total).toFixed(3)),
            memUsedGb: Number(((total - free) / 1024 ** 3).toFixed(1)),
            memTotalGb: Number((total / 1024 ** 3).toFixed(1)),
            load: Number(os.loadavg()[0].toFixed(2)),
            uptimeSec: Math.round((Date.now() - startedAt) / 1000),
            platform: os.platform(),
          });
        }),
      }));


      /* 立绘：拆成独立文件后由这里供出（代替原来的 base64 内联） */
      disposed.push(child.webServer.register({
        kind: 'prefix',
        path: `${PREFIX}/img`,
        handler: safe('img', (req, res) => {
          const raw = String(req.url ?? '').split('?')[0];
          const name = path.basename(raw.replace(/^.*\/img\/?/, ''));
          const file = path.join(ASSETS, 'mascot', name);
          if (!name || !fs.existsSync(file)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
          }
          serveFile(req, res, file);
        }),
      }));

      return () => {
        for (const dispose of disposed) {
          try {
            if (typeof dispose === 'function') dispose();
          } catch {
            /* 卸载阶段尽力而为 */
          }
        }
      };
    });
  });
}
