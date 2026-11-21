/**
 * 大肥鱼 · 深海终端 —— 客户端模块（React 插槽层）。
 *
 * DSH 的客户端插件是懒 CJS 模块（`window.__ModuleLoader__.load({ id, factory })`），
 * `apply(ctx)` 里的 `ctx.slots` 能把 React 组件注册进宿主的具名插槽 —— 也就是说，
 * mock 里那些"宿主本来没有的组件"（形象槽、chips 行、头部徽标）现在能真正长在宿主
 * 自己的布局里，而不是用固定定位硬贴上去。
 *
 * 用到的插槽（均在 dsh-client-ui-conversation / ui-agent-preset 的实现里确认过）：
 *   conversation.input.left              输入条左侧（mock 的「形象槽」）
 *   conversation.composer.dock           输入区底部 dock（mock 的 chips 行）
 *   conversation.session.header.actions  会话头部右侧（session-01 / 模型徽标）
 */
window.__ModuleLoader__.load({
  id: 'dsh-bigfatfish-theme',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;
    var C = {
      cyan: '#5fd8ff',
      blue: '#2e6bff',
      ice: '#b0eaff',
      amber: '#ffb05c',
      mint: '#4ff0c0',
      text: '#c8d8f0',
      dim: '#7e92b2',
      mute: '#4e5e7a',
      panel: 'rgba(5, 10, 20, 0.86)',
      line: 'rgba(95, 216, 255, 0.22)',
    };

    var FONT_CN = "'Microsoft YaHei', system-ui, sans-serif";
    var FONT_MONO = 'Consolas, ui-monospace, monospace';

    /** 输入框左侧的形象：直接用图一立绘（data URI 由 theme.js 的 MASCOT_CSS 提供） */
    function Fish(props) {
      var size = props.size || 34;
      return h('span', {
        style: {
          display: 'inline-block',
          flex: '0 0 auto',
          width: size,
          height: size,
          /* 不要任何底板/圆角/发光：只要人物本身 */
          backgroundColor: 'transparent',
          backgroundImage: 'var(--dbf-img-idle)',
          backgroundSize: 'contain',
          backgroundPosition: '50% 30%',
          backgroundRepeat: 'no-repeat',
          border: 0,
          boxShadow: 'none',
        },
        'aria-hidden': 'true',
      });
    }

    function Chip(props) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid ' + (props.color || C.cyan) + '55',
            color: props.color || C.cyan,
            background: 'rgba(4, 9, 18, 0.62)',
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          },
        },
        props.label
      );
    }

    /* 四态：与 theme.js 写的 html[data-dbf-state] 联动（DESIGN §5） */
    var STATE_TABLE = {
      idle: { label: 'IDLE', color: C.cyan },
      think: { label: 'BUSY', color: '#9dbdff' },
      approval: { label: 'HOLD', color: C.amber },
      error: { label: 'ERR', color: '#ff5fa8' },
    };

    function useDbfState() {
      var pair = React.useState('idle');
      var state = pair[0];
      var setState = pair[1];
      React.useEffect(function () {
        var read = function () {
          var next = document.documentElement.getAttribute('data-dbf-state') || 'idle';
          setState(function (prev) {
            return prev === next ? prev : next;
          });
        };
        read();
        var timer = window.setInterval(read, 800);
        return function () {
          window.clearInterval(timer);
        };
      }, []);
      return state;
    }

    /* ---------------------------------------------------------------- ① 输入条左侧：形象槽 */
    function InputSlot() {
      var state = useDbfState();
      var spec = STATE_TABLE[state] || STATE_TABLE.idle;
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 10px',
            marginRight: 8,
            borderRadius: 10,
            border: '1px solid ' + spec.color + '55',
            background: C.panel,
            boxShadow: 'inset 0 0 0 1px rgba(4,7,14,0.55), 0 0 18px ' + spec.color + '22',
            transition: 'border-color 240ms ease, box-shadow 240ms ease',
          },
          title: '大肥鱼 · ' + spec.label,
        },
        h(Fish, { size: 34 }),
        h(
          'span',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              fontFamily: FONT_CN,
              lineHeight: 1.1,
            },
          },
          h('span', { style: { color: C.ice, fontSize: 12 } }, '大肥鱼'),
          h(
            'span',
            {
              style: {
                color: spec.color,
                fontSize: 9,
                fontFamily: FONT_MONO,
                letterSpacing: '0.1em',
              },
            },
            spec.label
          )
        )
      );
    }

    /* ---------------------------------------------------------------- ② 输入区 dock：chips 行 */
    function ComposerDock() {
      var chips = [
        ['deepseek-flash', C.cyan],
        ['reasoning max', C.blue],
        ['ask', C.amber],
        ['ctx 62%', C.mint],
        ['mcp 3', C.dim],
      ];
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexWrap: 'nowrap',
            gap: 6,
            alignItems: 'center',
            padding: '5px 2px 0',
            overflow: 'hidden',
          },
        },
        chips.map(function (spec) {
          return h(Chip, { key: spec[0], label: spec[0], color: spec[1] });
        })
      );
    }

    /* ---------------------------------------------------------------- ③ 会话头部：徽标 */
    function HeaderBadges() {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 } },
        h(Chip, { label: 'deepseek-flash', color: C.cyan }),
        h(Chip, { label: 'reasoning max', color: C.blue })
      );
    }

    /* ---------------------------------------------------------------- 注册 */
    function apply(ctx) {
      window.__DBF_CLIENT__ = 'v1';
      try {
        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register(
            { name: 'conversation.input.left', id: 'bigfatfish-slot', order: 10 },
            InputSlot
          );
        });
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'bigfatfish-chips', order: 30 },
            ComposerDock
          );
        });
        ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'bigfatfish-badges', order: 40 },
            HeaderBadges
          );
        });
        window.__DBF_SLOTS__ = 'input.left,composer.dock,header.actions';
      } catch (error) {
        window.__DBF_CLIENT_ERR__ = String((error && error.message) || error);
      }
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
