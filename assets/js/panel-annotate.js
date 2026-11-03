/* 右侧详情批注模块：划词高亮 + 悬浮批注弹窗 + 圈划
   交互：
   1. 选中正文文字 → 选区旁浮出「高亮 / 圈划 / 备注」小浮层；
   2. 悬停或点击已有高亮 → 浮出批注卡片，可直接查看、编辑备注、切换圈划或删除。
   依赖：web-highlighter（文本锚定）、rough-notation（圈划） */
(function () {
  "use strict";

  const KEY = "cm_panel_anno_v1";
  const Highlighter = window.Highlighter;
  const RoughNotation = window.RoughNotation;

  let root = null;           // #panelBody，页面常驻，内容每次重绘
  let hl = null;             // 高亮器单例，$root 固定为 #panelBody
  let currentKey = "";       // 当前节点的唯一键（节点路径）
  let lastRange = null;      // 最近一次落在正文中的有效选区
  let data = load();
  let restoring = false;     // 回填旧批注期间忽略 CREATE 事件
  const marks = new Map();   // 批注 id → rough-notation 实例数组
  let toolbar = null;

  // 悬浮弹窗状态
  let pop = null;            // 弹窗节点，面板重绘后需重新挂载
  let popMode = "";          // selection | view | edit
  let popId = "";            // 当前批注 id
  let showTimer = 0;         // 悬停/选区延迟显示计时器
  let hideTimer = 0;         // 离开后的延迟隐藏计时器

  /* ---------- 存储 ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { /* 隐私模式下仅本次会话有效 */ }
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 用节点路径做键，保证不同章节的同名知识点互不串批注
  function keyOf(node) {
    const path = [];
    for (let p = node; p; p = p.parent) path.unshift(p.name);
    return path.join(" / ");
  }

  function records() {
    if (!data[currentKey]) data[currentKey] = [];
    return data[currentKey];
  }

  function findRec(id) {
    return records().find(r => r.id === id) || null;
  }

  /* ---------- 选区 ---------- */
  // 只接受正文段落内的选区，避免把弹窗里的文字也算进来
  function isBodyText(range) {
    if (!range || range.collapsed) return false;
    const node = range.commonAncestorContainer;
    if (!root || !root.contains(node)) return false;
    const host = node.nodeType === 1 ? node : node.parentElement;
    if (!host) return false;
    return !host.closest(".anno-pop");
  }

  function onSelectionChange() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    if (!isBodyText(range)) {
      // 选区消失时只收起「选区浮层」，查看/编辑中的卡片保持
      if (popMode === "selection") hidePop();
      return;
    }

    lastRange = range.cloneRange();
    if (popMode === "edit") return;   // 正在写备注，不打断

    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (!isBodyText(lastRange)) return;
      const rect = lastRange.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      showSelectionPop(rect);
    }, 120);
  }

  /* ---------- 高亮与批注数据 ---------- */
  // 从 highlighter 返回的 source 建立/取得记录，避免依赖事件时序
  function ensureRec(src) {
    const list = records();
    let rec = list.find(r => r.id === src.id);
    if (!rec) {
      rec = {
        id: src.id,
        text: src.text,
        startMeta: src.startMeta,
        endMeta: src.endMeta,
        note: "",
        style: ""
      };
      list.push(rec);
      save();
    }
    return rec;
  }

  function onCreate({ sources }) {
    if (restoring || !sources) return;
    sources.forEach(ensureRec);
    refreshStatus();
  }

  // 工具栏/浮层入口：把当前选区转成高亮
  // withMark 圈划；openEditor 创建后直接打开备注编辑
  function newHighlight(withMark, openEditor) {
    if (!hl) return;
    if (!isBodyText(lastRange)) {
      flash("请先在正文中选中文字");
      return;
    }
    const source = hl.fromRange(lastRange);
    lastRange = null;
    if (!source) return;

    const rec = ensureRec(source);
    if (withMark) {
      rec.style = "box";
      applyMark(rec);
      save();
    }

    hidePop();
    refreshStatus();

    // 等包裹节点生成后再取位置
    if (openEditor) {
      requestAnimationFrame(() => {
        showEditPop(rec.id, anchorRectOfId(rec.id));
      });
    }
  }

  // 当前批注在页面中的位置；用于把卡片贴到高亮上方
  function anchorRectOfId(id) {
    const doms = (hl && hl.getDoms(id)) || [];
    return doms.length ? doms[0].getBoundingClientRect() : null;
  }

  /* ---------- 圈划 ---------- */
  function applyMark(rec) {
    if (!hl || !RoughNotation || marks.has(rec.id)) return;
    const doms = hl.getDoms(rec.id) || [];
    if (!doms.length) return;
    // 跨行的高亮会拆成多个包裹节点，逐个按行框画
    const anns = doms.map(el => RoughNotation.annotate(el, {
      type: rec.style === "circle" ? "circle" : "box",
      color: "#f59e0b",
      strokeWidth: 2,
      padding: 4,
      multiline: true
    }));
    anns.forEach(a => a.show());
    marks.set(rec.id, anns);
  }

  function removeMark(id) {
    const anns = marks.get(id);
    if (anns) anns.forEach(a => a.remove());
    marks.delete(id);
  }

  function clearMarks() {
    marks.forEach(anns => anns.forEach(a => a.remove()));
    marks.clear();
  }

  function toggleMark(id) {
    const rec = findRec(id);
    if (!rec) return;
    if (rec.style) {
      rec.style = "";
      removeMark(id);
    } else {
      rec.style = "box";
      applyMark(rec);
    }
    save();
    showViewPop(id, anchorRectOfId(id));
  }

  /* ---------- 悬浮弹窗 ---------- */
  function ensurePop() {
    if (pop && pop.isConnected) return pop;
    pop = document.createElement("div");
    pop.className = "anno-pop";
    pop.hidden = true;
    // 按下按钮时保留文本选区，否则「高亮选中」会立刻丢失选区
    pop.addEventListener("mousedown", e => {
      if (e.target.closest("button")) e.preventDefault();
    });
    pop.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    pop.addEventListener("mouseleave", () => {
      if (popMode !== "edit") scheduleHide();
    });
    pop.addEventListener("click", onPopClick);
    pop.addEventListener("keydown", e => {
      if (!e.target.matches("textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        saveNote();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    });
    root.appendChild(pop);
    return pop;
  }

  // 定位到选区或高亮附近，优先放上方，空间不足则放下方
  function placePop(rect) {
    if (!pop || pop.hidden) return;
    const panel = document.getElementById("panel");
    if (!panel) return;
    const pr = panel.getBoundingClientRect();
    if (!rect) {
      rect = {
        left: pr.left + pr.width / 2 - 80,
        width: 160,
        top: pr.top + 90,
        bottom: pr.top + 120
      };
    }
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;

    let left = rect.left + rect.width / 2 - pw / 2;
    let top = rect.top - ph - 8;
    if (top < pr.top + 8) top = (rect.bottom || rect.top) + 8;

    left = Math.max(pr.left + 8, Math.min(left, pr.right - pw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function showSelectionPop(rect) {
    const text = lastRange ? lastRange.toString().trim() : "";
    if (!text) return;
    popMode = "selection";
    popId = "";
    ensurePop();
    pop.innerHTML = `
      <div class="anno-pop-quote">“${esc(text.length > 42 ? text.slice(0, 42) + "…" : text)}”</div>
      <div class="anno-pop-actions">
        <button data-op="hl">高亮</button>
        <button data-op="mark">圈划</button>
        <button data-op="note">备注</button>
      </div>`;
    pop.hidden = false;
    placePop(rect);
  }

  function showViewPop(id, rect) {
    const rec = findRec(id);
    if (!rec) return;
    popMode = "view";
    popId = id;
    ensurePop();
    pop.innerHTML = `
      <div class="anno-pop-quote">“${esc(rec.text)}”</div>
      <div class="anno-pop-note">${rec.note ? esc(rec.note) : '<span class="anno-empty">暂无备注</span>'}</div>
      <div class="anno-pop-ops">
        <button data-op="edit">编辑备注</button>
        <button data-op="mark">${rec.style ? "取消圈划" : "圈划"}</button>
        <button data-op="remove">删除</button>
      </div>`;
    pop.hidden = false;
    placePop(rect);
  }

  function showEditPop(id, rect) {
    const rec = findRec(id);
    if (!rec) return;
    popMode = "edit";
    popId = id;
    ensurePop();
    pop.innerHTML = `
      <div class="anno-pop-quote">“${esc(rec.text)}”</div>
      <textarea data-role="editor" placeholder="写下这条批注…（Ctrl/⌘ + Enter 保存）">${esc(rec.note)}</textarea>
      <div class="anno-pop-ops">
        <button data-op="save">保存</button>
        <button data-op="cancel">取消</button>
        <button data-op="remove">删除</button>
      </div>`;
    pop.hidden = false;
    placePop(rect);
    const ta = pop.querySelector("textarea");
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function hidePop() {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (!pop) return;
    pop.hidden = true;
    popMode = "";
    popId = "";
    pop.innerHTML = "";
  }

  function scheduleHide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (popMode !== "edit") hidePop();
    }, delay || 260);
  }

  /* ---------- 弹窗内的操作 ---------- */
  function onPopClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const op = btn.dataset.op;

    if (op === "hl") { newHighlight(false, false); return; }
    if (op === "note") { newHighlight(false, true); return; }
    if (op === "mark") {
      if (popMode === "selection") newHighlight(true, false);
      else toggleMark(popId);
      return;
    }
    if (op === "edit") { showEditPop(popId, anchorRectOfId(popId)); return; }
    if (op === "save") { saveNote(); return; }
    if (op === "cancel") { cancelEdit(); return; }
    if (op === "remove") { removeRec(popId); return; }
  }

  function saveNote() {
    const rec = findRec(popId);
    if (!rec) return;
    const ta = pop && pop.querySelector("textarea");
    rec.note = ta ? ta.value.trim() : "";
    save();
    // 保存后回落到查看态，避免卡片突然消失
    showViewPop(popId, anchorRectOfId(popId));
  }

  function cancelEdit() {
    if (popMode === "edit") showViewPop(popId, anchorRectOfId(popId));
    else hidePop();
  }

  function removeRec(id) {
    removeMark(id);
    if (hl) hl.remove(id);
    data[currentKey] = records().filter(r => r.id !== id);
    save();
    hidePop();
    refreshStatus();
  }

  /* ---------- 悬停已有高亮 ---------- */
  function onRootOver(e) {
    const wrap = e.target.closest("[data-highlight-id]");
    if (!wrap || !root.contains(wrap)) return;
    if (popMode === "edit") return;      // 编辑备注时不打断
    const id = wrap.dataset.highlightId;
    if (popMode === "view" && popId === id) {
      clearTimeout(hideTimer);
      return;
    }
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (popMode === "edit") return;
      showViewPop(id, wrap.getBoundingClientRect());
    }, 260);
  }

  function onRootOut(e) {
    const wrap = e.target.closest("[data-highlight-id]");
    if (!wrap) return;
    clearTimeout(showTimer);
    if (popMode === "view") scheduleHide();
  }

  /* ---------- 工具栏状态 ---------- */
  function refreshStatus() {
    if (!toolbar) return;
    const countEl = toolbar.querySelector('[data-role="count"]');
    if (!countEl) return;
    const n = records().length;
    countEl.textContent = n ? `本页 ${n} 条批注` : "选中正文文字即可批注";
  }

  function flash(text) {
    if (!toolbar) return;
    const countEl = toolbar.querySelector('[data-role="count"]');
    if (!countEl) return;
    countEl.textContent = text;
    setTimeout(refreshStatus, 1600);
  }

  function buildToolbar() {
    toolbar = document.createElement("div");
    toolbar.className = "anno-bar";
    toolbar.innerHTML = `
      <span class="anno-count" data-role="count"></span>
      <button class="anno-btn ghost" data-op="clear">清空本页批注</button>`;
    document.getElementById("panelTag").after(toolbar);
    toolbar.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (btn && btn.dataset.op === "clear") clearNode();
    });
  }

  function clearNode() {
    const list = records();
    if (!list.length) return;
    list.forEach(rec => {
      removeMark(rec.id);
      if (hl) hl.remove(rec.id);
    });
    data[currentKey] = [];
    save();
    hidePop();
    refreshStatus();
  }

  /* ---------- 对外接口 ---------- */
  function init() {
    root = document.getElementById("panelBody");
    if (!root) return;
    if (!Highlighter) return;  // 库缺失时静默降级，不影响导图本身
    hl = new Highlighter({ $root: root });
    hl.on(Highlighter.event.CREATE, onCreate);
    hl.on(Highlighter.event.CLICK, ({ id }) => {
      if (popMode === "edit") return;
      showViewPop(id, anchorRectOfId(id));
    });
    buildToolbar();
    document.addEventListener("selectionchange", onSelectionChange);
    root.addEventListener("mouseover", onRootOver);
    root.addEventListener("mouseout", onRootOut);
    // 点击空白处收起浮层；滚动/缩放时也收起，避免位置漂移
    root.addEventListener("mousedown", e => {
      if (e.target.closest(".anno-pop") || e.target.closest("[data-highlight-id]")) return;
      if (popMode !== "edit") hidePop();
    });
    const panel = document.getElementById("panel");
    if (panel) panel.addEventListener("scroll", () => { if (popMode !== "edit") hidePop(); });
    window.addEventListener("resize", () => { if (popMode !== "edit") hidePop(); });
  }

  // map-view 每次重绘面板后调用：回填该节点的旧批注，并重置浮层
  function mount(node, body) {
    if (!hl) return;
    root = body;
    currentKey = keyOf(node);
    pop = null;                  // 旧弹窗随 innerHTML 一起被清空
    popMode = "";
    popId = "";
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    clearMarks();
    // 内容已重绘，旧的包裹节点随 innerHTML 一起消失，这里清掉高亮器内部缓存
    hl.removeAll();

    restoring = true;
    records().forEach(rec => {
      try {
        hl.fromStore(rec.startMeta, rec.endMeta, rec.text, rec.id);
      } catch (e) {
        // 正文发生过改动时锚点可能失效，跳过这一条即可
      }
    });
    restoring = false;

    records().forEach(rec => { if (rec.style) applyMark(rec); });
    refreshStatus();
  }

  window.PanelAnnotate = { init, mount };
})();
