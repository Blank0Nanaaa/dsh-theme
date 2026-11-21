/**
 * 大肥鱼 · 深海终端 —— 引导脚本（宿主以 inline <script> 注入）。
 *
 * 三个职责：
 *   1. 打点：把每一步的成败回报给 /dbf/beacon，宿主写进 logs/beacon.log —— 这样
 *      "注入到底跑没跑、拉文件成没成功" 不用靠猜。
 *   2. 找到能用的素材基址：桌面壳的页面源是自定义协议（dsh://app），相对路径可能
 *      被转发也可能不，所以依次尝试 ① __DSH_TRANSPORT__.streamBaseUrl
 *      ② __DSH_BOOT__.streamBaseUrl ③ location.origin ④ http://127.0.0.1:19387 兜底。
 *   3. 拉取 theme.css / theme.js，并每 1.5 秒比对文本 —— 改文件即热更，不用重启。
 */
(function () {
  'use strict';
  if (window.__DBF_BOOT__) return;
  window.__DBF_BOOT__ = '1';

  var FILES = { css: '/dbf/theme.css', js: '/dbf/theme.js' };
  var INTERVAL = 1500;
  var styleEl = null;
  var lastCss = '';
  var lastJs = '';
  var base = null;

  function beacon(event) {
    try {
      var img = new Image();
      img.src = '/dbf/beacon?e=' + encodeURIComponent(String(event).slice(0, 160)) + '&t=' + Date.now();
    } catch (e) {
      /* ignore */
    }
  }

  function warn(where, err) {
    try {
      console.warn('[dbf ' + where + ']', err && err.message ? err.message : err);
    } catch (e) {
      /* ignore */
    }
    beacon('err:' + where + ':' + (err && err.message ? err.message : err));
  }

  function bases() {
    var list = [];
    function push(value) {
      if (typeof value !== 'string' || !value) return;
      var clean = value.replace(/\/+$/, '');
      if (list.indexOf(clean) < 0) list.push(clean);
    }
    try {
      push(window.__DSH_TRANSPORT__ && window.__DSH_TRANSPORT__.streamBaseUrl);
    } catch (e) {
      /* ignore */
    }
    try {
      push(window.__DSH_BOOT__ && window.__DSH_BOOT__.streamBaseUrl);
    } catch (e) {
      /* ignore */
    }
    push(location.origin);
    push('http://127.0.0.1:19387');
    return list;
  }

  function probe(candidate, path) {
    return fetch(candidate + path + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text().then(function (text) {
        if (!text || text.length < 20) throw new Error('empty body');
        return text;
      });
    });
  }

  /** 依次尝试候选基址，返回第一个能拿到 CSS 的。 */
  function resolveBase() {
    var list = bases();
    var index = 0;
    function step() {
      if (index >= list.length) return Promise.reject(new Error('no reachable base'));
      var candidate = list[index];
      index += 1;
      return probe(candidate, FILES.css)
        .then(function (text) {
          base = candidate;
          window.__DBF_BASE__ = candidate;
          beacon('base-ok:' + candidate);
          return text;
        })
        .catch(function (error) {
          beacon('base-fail:' + candidate + ':' + error.message);
          return step();
        });
    }
    return step();
  }

  function applyCss(text) {
    if (!styleEl) {
      styleEl = document.getElementById('dbf-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'dbf-style';
        document.head.appendChild(styleEl);
      }
    }
    if (styleEl.textContent !== text) styleEl.textContent = text;
  }

  function runJs(text) {
    try {
      var holder = document.body || document.documentElement;
      var tag = document.createElement('script');
      tag.textContent = text;
      holder.appendChild(tag);
      if (tag.parentNode) tag.parentNode.removeChild(tag);
      return true;
    } catch (error) {
      warn('runjs', error);
      return false;
    }
  }

  function get(path) {
    return fetch(base + path + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function cycle(force) {
    if (!base) return;
    get(FILES.css)
      .then(function (text) {
        if (force || text !== lastCss) {
          lastCss = text;
          applyCss(text);
        }
      })
      .catch(function (e) {
        warn('css', e);
      });
    get(FILES.js)
      .then(function (text) {
        if (force || text !== lastJs) {
          lastJs = text;
          if (runJs(text)) beacon('js-applied');
        }
      })
      .catch(function (e) {
        warn('js', e);
      });
  }

  function boot() {
    beacon('boot');
    resolveBase()
      .then(function (firstCss) {
        lastCss = firstCss;
        applyCss(firstCss);
        beacon('boot-css-ok');
        cycle(true);
        setInterval(function () {
          cycle(false);
        }, INTERVAL);
      })
      .catch(function (error) {
        warn('resolve', error);
      });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
