/**
 * dsh-composer-resize（客户端侧）
 *
 * DSH 的聊天输入框会跟着内容长到 336px 才滚动，而且不能拖。这个插件在输入卡片顶部
 * 加一条把手，并且改“固定高度”而不是只改最大高度 —— 所以哪怕只有一行字，也能随意拉大拉小：
 *
 *   - 拖动：输入框高度 = 你拖到的位置（64px ~ 72% 屏高），内容超出就内部滚动；
 *   - 拖过之后进入“固定高度”模式，不再跟着内容自己变高；
 *   - 双击把手：回到“自动增高”模式（上限 168px，也就是官方默认的自动增长）；
 *   - 平时把手几乎不可见，鼠标移到输入框或聚焦时出现。
 *
 * 只改 [data-input-scroll] 的 height/max-height，不碰任何 React 组件。
 *
 * @module dsh-composer-resize/client
 */

window.__ModuleLoader__.load({
  id: "dsh-composer-resize",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;

    const STORAGE_KEY = "dsh-composer-resize.state.v2";
    const CARD_SELECTOR = "[data-composer-card]";
    const SCROLL_SELECTOR = "[data-input-scroll]";
    const HANDLE_ATTR = "data-dsh-composer-resize";
    const STYLE_ATTR = "data-dsh-composer-resize-style";

    const MIN_HEIGHT = 64;
    const DEFAULT_HEIGHT = 168;
    const MAX_RATIO = 0.72;
    const MAX_ABS = 900;

    const CSS = [
      ".dscr-handle{position:absolute;left:50%;top:-4px;transform:translateX(-50%);width:64px;height:10px;border-radius:5px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .16s ease;z-index:6;touch-action:none}",
      ".dscr-handle::before{content:\"\";width:34px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l3,#7a7f87);opacity:.55;transition:opacity .16s ease}",
      "[data-composer-card]:hover .dscr-handle,[data-composer-card]:focus-within .dscr-handle,.dscr-handle.is-active{opacity:1;pointer-events:auto}",
      ".dscr-handle:hover::before,.dscr-handle.is-active::before{opacity:.95}",
      ".dscr-label{position:absolute;right:12px;top:-20px;padding:1px 6px;border-radius:6px;font-size:11px;line-height:16px;white-space:nowrap;background:var(--dsw-alias-bg-layer-2,#1c1c1e);color:var(--dsw-alias-label-secondary,#9ca3af);opacity:0;transition:opacity .15s ease;pointer-events:none;z-index:7}",
      "body.dscr-dragging{cursor:ns-resize}",
      "body.dscr-dragging *{cursor:ns-resize !important;user-select:none !important}",
    ].join("");

    let state = { mode: "auto", height: DEFAULT_HEIGHT };
    let observer = null;
    let timer = null;
    let frame = 0;

    function messageOf(error) {
      return String((error && error.message) || error);
    }

    function maxAllowed() {
      const viewport = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 900;
      return Math.max(MIN_HEIGHT + 48, Math.min(Math.round(viewport * MAX_RATIO), MAX_ABS));
    }

    function clamp(value) {
      const number = Number(value);
      if (!isFinite(number)) return DEFAULT_HEIGHT;
      return Math.max(MIN_HEIGHT, Math.min(Math.round(number), maxAllowed()));
    }

    function readState() {
      const fallback = { mode: "auto", height: DEFAULT_HEIGHT };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            return {
              mode: parsed.mode === "fixed" ? "fixed" : "auto",
              height: clamp(parsed.height),
            };
          }
        }
        // 兼容第一版：存的是纯数字，按“自动增高”处理。
        const legacy = Number(window.localStorage.getItem("dsh-composer-resize.height.v1"));
        if (isFinite(legacy) && legacy > 0) return { mode: "auto", height: clamp(legacy) };
      } catch (_) {
        // 存储不可用就用默认值。
      }
      return fallback;
    }

    function saveState() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_) {
        // 记不住高度而已。
      }
    }

    function ensureStyle() {
      if (document.querySelector("style[" + STYLE_ATTR + "]") !== null) return;
      const style = document.createElement("style");
      style.setAttribute(STYLE_ATTR, "");
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    function scrollerOf(card) {
      return card.querySelector(SCROLL_SELECTOR);
    }

    /** 把当前 state 应用到一张输入卡片上。 */
    function applyState(card) {
      const height = clamp(state.height);

      const scroller = scrollerOf(card);
      if (scroller) {
        scroller.style.overflowY = "auto";
        if (state.mode === "fixed") {
          // 固定高度：内容少也保持这个高度，多了就在框里滚动。
          scroller.style.height = height + "px";
          scroller.style.minHeight = height + "px";
          scroller.style.maxHeight = height + "px";
          scroller.style.flex = "0 0 auto";
        } else {
          // 自动增高：跟着内容长，封顶 height。
          scroller.style.height = "";
          scroller.style.minHeight = "";
          scroller.style.maxHeight = height + "px";
          scroller.style.flex = "";
        }
      }

      card.style.setProperty("--dsh-composer-text-max-height", height + "px");
      card.setAttribute("data-dsh-composer-mode", state.mode);
      return height;
    }

    function bindDrag(handle, card) {
      if (handle.__dscrBound === true) return;
      handle.__dscrBound = true;

      const label = document.createElement("div");
      label.className = "dscr-label";
      label.setAttribute("aria-hidden", "true");
      card.appendChild(label);

      let dragging = false;
      let frozen = false;
      let startY = 0;
      let startHeight = DEFAULT_HEIGHT;

      const showLabel = (value) => {
        label.textContent = Math.round(value) + " px";
        label.style.opacity = "1";
      };

      const hideLabel = () => {
        label.style.opacity = "0";
      };

      const stop = (event) => {
        if (!dragging) return;
        dragging = false;
        frozen = false;
        handle.classList.remove("is-active");
        document.body.classList.remove("dscr-dragging");
        saveState();
        hideLabel();
        if (event && event.pointerId !== undefined) {
          try { handle.releasePointerCapture(event.pointerId); } catch (_) { /* 忽略 */ }
        }
      };

      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const scroller = scrollerOf(card);
        if (!scroller) return;
        startY = event.clientY;
        // 从“当前实际高度”开始拖：内容少时就是那一两行的高度，往上拖就能拉大。
        startHeight = scroller.getBoundingClientRect().height || state.height;
        dragging = true;
        frozen = false;
        handle.classList.add("is-active");
        document.body.classList.add("dscr-dragging");
        showLabel(startHeight);
        try { handle.setPointerCapture(event.pointerId); } catch (_) { /* 忽略 */ }
      });

      handle.addEventListener("pointermove", function (event) {
        if (!dragging) return;
        event.preventDefault();
        const next = clamp(startHeight + (startY - event.clientY));
        if (!frozen) {
          // 第一次真正移动时才切到固定高度，避免只是点一下就把高度冻住。
          frozen = true;
          state = { mode: "fixed", height: next };
        } else {
          state = { mode: "fixed", height: next };
        }
        applyState(card);
        showLabel(next);
      });

      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      handle.addEventListener("lostpointercapture", function () { if (dragging) stop(null); });

      handle.addEventListener("dblclick", function (event) {
        event.preventDefault();
        event.stopPropagation();
        state = { mode: "auto", height: DEFAULT_HEIGHT };
        applyState(card);
        saveState();
        showLabel(DEFAULT_HEIGHT);
        setTimeout(hideLabel, 700);
      });
    }

    function enhance() {
      const cards = document.querySelectorAll(CARD_SELECTOR);
      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i];
        if (scrollerOf(card) === null) continue;

        let handle = card.querySelector("[" + HANDLE_ATTR + "]");
        if (handle === null) {
          handle = document.createElement("div");
          handle.className = "dscr-handle";
          handle.setAttribute(HANDLE_ATTR, "");
          handle.setAttribute("role", "separator");
          handle.setAttribute("aria-orientation", "horizontal");
          handle.setAttribute("aria-label", "拖动调整输入框高度（双击恢复自动增高）");
          card.appendChild(handle);
          bindDrag(handle, card);
        }
        applyState(card);
      }
    }

    function schedule() {
      if (frame !== 0) return;
      const run = function () {
        frame = 0;
        try { enhance(); } catch (error) { console.warn("[composer-resize] enhance 失败", messageOf(error)); }
      };
      frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 16);
    }

    function apply() {
      try {
        state = readState();
        ensureStyle();
        enhance();

        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener("resize", schedule);

        // 兜底：React 重建输入框后补回把手与高度。
        timer = setInterval(function () { try { enhance(); } catch (_) { /* 忽略 */ } }, 1500);

        return function dispose() {
          if (observer) observer.disconnect();
          if (timer) clearInterval(timer);
          window.removeEventListener("resize", schedule);

          const style = document.querySelector("style[" + STYLE_ATTR + "]");
          if (style) style.remove();

          const cards = document.querySelectorAll(CARD_SELECTOR);
          for (let i = 0; i < cards.length; i += 1) {
            const card = cards[i];
            card.removeAttribute("data-dsh-composer-mode");
            card.style.removeProperty("--dsh-composer-text-max-height");
            const scroller = scrollerOf(card);
            if (scroller) {
              scroller.style.height = "";
              scroller.style.minHeight = "";
              scroller.style.maxHeight = "";
              scroller.style.flex = "";
            }
          }

          const handles = document.querySelectorAll("[" + HANDLE_ATTR + "]");
          for (let i = 0; i < handles.length; i += 1) handles[i].remove();
          const labels = document.querySelectorAll(".dscr-label");
          for (let i = 0; i < labels.length; i += 1) labels[i].remove();
        };
      } catch (error) {
        console.warn("[composer-resize] 初始化失败，已跳过", messageOf(error));
        return function () {};
      }
    }

    exports.apply = apply;
    exports.inject = [];
    exports.__test = { clamp: clamp, maxAllowed: maxAllowed, DEFAULT_HEIGHT: DEFAULT_HEIGHT, MIN_HEIGHT: MIN_HEIGHT };

    return module.exports;
  },
});
