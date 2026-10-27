/**
 * dsh-composer-resize（客户端侧）
 *
 * 聊天输入框（composer）默认会随内容长到 336px 才出现滚动条，而且不能拖。
 * 这个插件在输入卡片的顶部加一条可拖动的把手：
 *
 *   - 拖动：调整输入框的最大高度（64px ~ 72vh），松手记住；
 *   - 双击把手：恢复默认 168px；
 *   - 平时几乎不可见，鼠标移到输入框或聚焦时出现；
 *   - 只改 [data-input-scroll] 的 max-height，不动任何 React 组件。
 *
 * @module dsh-composer-resize/client
 */

window.__ModuleLoader__.load({
  id: "dsh-composer-resize",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;

    const STORAGE_KEY = "dsh-composer-resize.height.v1";
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

    let height = DEFAULT_HEIGHT;
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

    function readHeight() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return DEFAULT_HEIGHT;
        return clamp(raw);
      } catch (_) {
        return DEFAULT_HEIGHT;
      }
    }

    function saveHeight() {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(height));
      } catch (_) {
        // 存储不可用时只是记不住高度。
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

    function applyHeight(card, value) {
      const next = clamp(value);
      height = next;
      const scroller = scrollerOf(card);
      if (scroller) {
        scroller.style.maxHeight = next + "px";
        scroller.style.overflowY = "auto";
      }
      card.style.setProperty("--dsh-composer-text-max-height", next + "px");
      return next;
    }

    function bindDrag(handle, card) {
      if (handle.__dscrBound === true) return;
      handle.__dscrBound = true;

      const label = document.createElement("div");
      label.className = "dscr-label";
      label.setAttribute("aria-hidden", "true");
      card.appendChild(label);

      let dragging = false;
      let startY = 0;
      let startHeight = DEFAULT_HEIGHT;

      const showLabel = (value) => {
        label.textContent = Math.round(value) + " px";
        label.style.opacity = "1";
      };

      const stop = (event) => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove("is-active");
        label.style.opacity = "0";
        document.body.classList.remove("dscr-dragging");
        saveHeight();
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
        startHeight = scroller.getBoundingClientRect().height || height;
        dragging = true;
        handle.classList.add("is-active");
        document.body.classList.add("dscr-dragging");
        showLabel(startHeight);
        try { handle.setPointerCapture(event.pointerId); } catch (_) { /* 忽略 */ }
      });

      handle.addEventListener("pointermove", function (event) {
        if (!dragging) return;
        event.preventDefault();
        const next = clamp(startHeight + (startY - event.clientY));
        applyHeight(card, next);
        showLabel(next);
      });

      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      handle.addEventListener("lostpointercapture", function () { if (dragging) stop(null); });

      handle.addEventListener("dblclick", function (event) {
        event.preventDefault();
        event.stopPropagation();
        applyHeight(card, DEFAULT_HEIGHT);
        saveHeight();
        showLabel(DEFAULT_HEIGHT);
        setTimeout(function () { label.style.opacity = "0"; }, 700);
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
          handle.setAttribute("aria-label", "拖动调整输入框高度（双击恢复默认）");
          card.appendChild(handle);
          bindDrag(handle, card);
        }
        applyHeight(card, height);
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
        height = readHeight();
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
