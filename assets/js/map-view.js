/* 知识图谱模块：只负责导图渲染与交互，不感知答题页 */
(function () {
  "use strict";

  const DATA = window.MAP_DATA;
  const NS = "http://www.w3.org/2000/svg";

  // 版式参数
  const COL_W = [190, 185, 200, 265];
  const NODE_H = 34;
  const ROOT_H = 46;
  const COL_GAP = 82;
  const PAD_X = 48, PAD_TOP = 70;
  const GAP_LEAF = 22;
  const GAP_BRANCH = 30;
  const CHAPTER_GAP = 46;
  const MIN_SCALE = 0.5, MAX_SCALE = 1.5;

  let svgEl, stageEl, viewportEl, panelEl, splitterEl, appEl;
  let cursorY = PAD_TOP;
  let scale = 0.9;
  let selected = DATA;
  let options = {};
  let initialized = false;

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function nodeX(depth) {
    let x = PAD_X;
    for (let i = 0; i < depth; i++) x += COL_W[i] + COL_GAP;
    return x;
  }

  /* ---------- 布局 ---------- */
  function layout(node, depth, color) {
    node.depth = depth;
    node.color = color;
    node.w = COL_W[depth];
    node.h = depth === 0 ? ROOT_H : NODE_H;
    node.x = nodeX(depth);

    const kids = node.collapsed ? [] : (node.children || []);
    if (!kids.length) {
      node.y = cursorY;
      cursorY += node.h + (depth >= 3 ? GAP_LEAF : GAP_BRANCH);
      return;
    }
    kids.forEach(child => layout(child, depth + 1, node.color));
    const first = kids[0];
    const last = kids[kids.length - 1];
    node.y = (first.y + last.y + last.h) / 2 - node.h / 2;
  }

  function visibleNodes() {
    const list = [];
    (function walk(n) {
      list.push(n);
      if (!n.collapsed) (n.children || []).forEach(walk);
    })(DATA);
    return list;
  }

  /* ---------- 绘制 ---------- */
  function drawConnector(parent, child) {
    const x1 = parent.x + parent.w;
    // 根节点从垂直主干上分叉，其余节点从自身右侧中点出发
    const y1 = parent.depth === 0 ? (child.y + child.h / 2) : (parent.y + parent.h / 2);
    const x2 = child.x;
    const y2 = child.y + child.h / 2;
    const mid = (x2 - x1) / 2;

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d",
      `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", hexToRgba(child.color, 0.42));
    path.setAttribute("stroke-width", "1.6");
    svgEl.appendChild(path);
  }

  function drawToggle(node, g) {
    const cx = node.x + node.w, cy = node.y + node.h / 2;
    const group = document.createElementNS(NS, "g");
    group.setAttribute("class", "toggle");

    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", "8");
    circle.setAttribute("fill", "#ffffff");
    circle.setAttribute("stroke", node.depth === 1 ? "#ffffff" : node.color);
    circle.setAttribute("stroke-width", "1.2");
    group.appendChild(circle);

    const sign = document.createElementNS(NS, "text");
    sign.setAttribute("x", cx);
    sign.setAttribute("y", cy + 4);
    sign.setAttribute("text-anchor", "middle");
    sign.setAttribute("font-size", "12");
    sign.setAttribute("fill", node.color);
    sign.textContent = node.collapsed ? "＋" : "−";
    group.appendChild(sign);

    group.addEventListener("click", ev => {
      ev.stopPropagation();
      node.collapsed = !node.collapsed;
      render();
    });
    g.appendChild(group);
  }

  function drawNode(node) {
    const hasChildren = !!(node.children && node.children.length);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "node" + (hasChildren ? " has-children" : "") +
      (node === selected ? " selected" : ""));

    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", node.x);
    rect.setAttribute("y", node.y);
    rect.setAttribute("width", node.w);
    rect.setAttribute("height", node.h);
    rect.setAttribute("rx", node.depth === 0 ? 12 : 9);
    rect.setAttribute("stroke-width", node === selected ? "2.6" : "1.2");

    if (node.depth === 0) {
      rect.setAttribute("fill", "#111827");
      rect.setAttribute("stroke", "#111827");
    } else if (node.depth === 1) {
      rect.setAttribute("fill", node.color);
      rect.setAttribute("stroke", node.color);
    } else if (node.depth === 2) {
      rect.setAttribute("fill", hexToRgba(node.color, 0.12));
      rect.setAttribute("stroke", node === selected ? node.color : hexToRgba(node.color, 0.55));
    } else {
      rect.setAttribute("fill", node === selected ? hexToRgba(node.color, 0.14) : "#ffffff");
      rect.setAttribute("stroke", node === selected ? node.color : "#d8dee9");
    }
    g.appendChild(rect);

    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", node.x + node.w / 2);
    text.setAttribute("y", node.y + node.h / 2 + 5);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "node-text");
    text.setAttribute("font-size", node.depth <= 1 ? "13.5" : "12.5");
    text.setAttribute("font-weight", node.depth <= 1 ? "600" : "400");
    let fill = "#374151";
    if (node.depth === 0 || node.depth === 1) fill = "#ffffff";
    else if (node.depth === 2) fill = node.color;
    text.setAttribute("fill", fill);
    text.textContent = node.name;
    g.appendChild(text);

    if (hasChildren && node.depth > 0) drawToggle(node, g);

    g.addEventListener("click", () => {
      selected = node;
      // 点击已收起的节点时自动展开，方便直接查看下级要点
      if (hasChildren && node.collapsed) node.collapsed = false;
      render();
      updatePanel();
    });
    svgEl.appendChild(g);
  }

  function render() {
    if (!initialized) return;
    svgEl.innerHTML = "";
    cursorY = PAD_TOP;
    DATA.children.forEach((chapter, i) => {
      layout(chapter, 1, chapter.color);
      if (i < DATA.children.length - 1) cursorY += CHAPTER_GAP;
    });
    DATA.depth = 0;
    DATA.w = COL_W[0];
    DATA.h = ROOT_H;
    DATA.x = PAD_X;
    DATA.y = PAD_TOP;
    const lastChapter = DATA.children[DATA.children.length - 1];

    // 根节点右侧的垂直主干，各章从主干上分叉
    const trunkX = DATA.x + DATA.w;
    const trunkTop = DATA.y + DATA.h / 2;
    const trunkBottom = lastChapter.y + lastChapter.h / 2;
    const trunk = document.createElementNS(NS, "line");
    trunk.setAttribute("x1", trunkX);
    trunk.setAttribute("y1", trunkTop);
    trunk.setAttribute("x2", trunkX);
    trunk.setAttribute("y2", trunkBottom);
    trunk.setAttribute("stroke", "#cbd5e1");
    trunk.setAttribute("stroke-width", "2");
    svgEl.appendChild(trunk);

    const nodes = visibleNodes();
    nodes.forEach(node => {
      if (!node.collapsed) (node.children || []).forEach(child => drawConnector(node, child));
    });
    nodes.forEach(drawNode);

    ["课程", "章", "主题", "要点"].forEach((title, i) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", nodeX(i) + 6);
      t.setAttribute("y", 36);
      t.setAttribute("font-size", "12");
      t.setAttribute("fill", "#93a0b4");
      t.setAttribute("letter-spacing", "1");
      t.textContent = title;
      svgEl.appendChild(t);
    });

    const maxX = Math.max(...nodes.map(n => n.x + n.w)) + PAD_X;
    const maxY = cursorY + 40;
    svgEl.setAttribute("width", maxX);
    svgEl.setAttribute("height", maxY);
    applyScale(maxX, maxY);
  }

  /* ---------- 右侧详情面板 ---------- */
  function updatePanel() {
    if (!initialized) return;
    const node = selected;
    panelEl.scrollTop = 0;
    const crumb = document.getElementById("panelCrumb");
    const title = document.getElementById("panelTitle");
    const tag = document.getElementById("panelTag");
    const body = document.getElementById("panelBody");

    const path = [];
    let p = node;
    while (p) { path.unshift(p.name); p = p.parent; }
    crumb.textContent = path.slice(0, -1).join(" / ") || "课程总览";
    title.textContent = node.name;
    tag.textContent = ["课程", "章", "主题", "要点"][node.depth] || "要点";

    body.innerHTML = "";
    if (node.d) {
      node.d.split("\n").forEach(line => {
        const p2 = document.createElement("p");
        p2.textContent = line;
        body.appendChild(p2);
      });
    } else if (node.children && node.children.length) {
      const p2 = document.createElement("p");
      p2.textContent = "该" + (node.depth === 1 ? "章" : "主题") + "包含以下 " +
        node.children.length + " 个知识点，点击左侧对应节点查看详细内容：";
      body.appendChild(p2);
      const ul = document.createElement("ul");
      ul.className = "panel-list";
      node.children.forEach(c => {
        const li = document.createElement("li");
        li.textContent = c.name;
        ul.appendChild(li);
      });
      body.appendChild(ul);
    } else {
      const p2 = document.createElement("p");
      p2.textContent = "暂无详细说明。";
      body.appendChild(p2);
    }

    // 章节节点提供跳转到答题页的入口
    if (node.depth === 1 && typeof options.onPracticeChapter === "function") {
      const btn = document.createElement("button");
      btn.className = "panel-link";
      btn.textContent = "练习本章题目 →";
      btn.addEventListener("click", () => options.onPracticeChapter(node.name));
      body.appendChild(btn);
    }

    addSlides(node, body);

    // 面板内容就绪后再交给批注模块，便于按节点回填高亮
    if (typeof options.onPanelReady === "function") options.onPanelReady(node, body);
  }

  // 在详情面板底部插入对应 PPT 幻灯片图片
  function addSlides(node, body) {
    if (!node.pdf) return;
    const m = node.name.match(/P(\d+)(?:-(\d+))?/);
    if (!m) return;
    let start = +m[1];
    let end = m[2] ? +m[2] : start;
    if (end < start) [start, end] = [end, start];

    const box = document.createElement("div");
    box.className = "panel-shots";
    const title = document.createElement("div");
    title.className = "panel-shots-title";
    title.textContent = start === end
      ? "对应课件：第 " + start + " 页"
      : "对应课件：第 " + start + "–" + end + " 页";
    box.appendChild(title);

    for (let page = start; page <= end; page++) {
      const url = "slides/" + node.pdf + "/p" + String(page).padStart(3, "0") + ".jpg";
      const fig = document.createElement("figure");
      fig.className = "shot";

      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.title = "点击查看原图";

      const img = document.createElement("img");
      img.src = url;
      img.alt = "第 " + page + " 页课件";
      img.loading = "lazy";
      a.appendChild(img);
      fig.appendChild(a);

      const cap = document.createElement("figcaption");
      cap.textContent = "第 " + page + " 页";
      fig.appendChild(cap);
      box.appendChild(fig);
    }
    body.appendChild(box);
  }

  /* ---------- 缩放 ---------- */
  function applyScale(maxX, maxY) {
    stageEl.style.transform = `scale(${scale})`;
    stageEl.style.width = (maxX * scale) + "px";
    stageEl.style.height = (maxY * scale) + "px";
  }

  function setScale(next) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    applyScale(+svgEl.getAttribute("width"), +svgEl.getAttribute("height"));
  }

  /* ---------- 数据预处理 ---------- */
  function prepareData() {
    // 记录父节点，供面包屑与章节跳转使用
    (function setParent(n, parent) {
      n.parent = parent;
      (n.children || []).forEach(c => setParent(c, n));
    })(DATA, null);

    // 每章及其所有下级节点绑定对应的课件图片目录（ch1~ch7）
    DATA.children.forEach((chapter, index) => {
      const key = "ch" + (index + 1);
      (function tag(n) {
        n.pdf = key;
        (n.children || []).forEach(tag);
      })(chapter);
    });
  }

  // 初始状态：显示章与主题，要点折叠
  function restoreCollapse() {
    (function walk(n, depth) {
      if (depth >= 2 && n.children && n.children.length) n.collapsed = true;
      (n.children || []).forEach(c => walk(c, depth + 1));
    })(DATA, 0);
  }

  /* ---------- 交互绑定 ---------- */
  function bindSplitter() {
    let resizing = false;

    splitterEl.addEventListener("pointerdown", ev => {
      resizing = true;
      splitterEl.classList.add("dragging");
      splitterEl.setPointerCapture(ev.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      ev.preventDefault();
    });

    window.addEventListener("pointermove", ev => {
      if (!resizing) return;
      const rect = appEl.getBoundingClientRect();
      const min = 280;
      const max = Math.max(min, Math.min(rect.width * 0.7, rect.width - 320));
      let w = rect.right - ev.clientX;
      w = Math.max(min, Math.min(max, w));
      panelEl.style.width = w + "px";
    });

    window.addEventListener("pointerup", () => {
      if (!resizing) return;
      resizing = false;
      splitterEl.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });

    splitterEl.addEventListener("dblclick", () => {
      panelEl.style.width = "390px";
    });
  }

  function bindCanvasPan() {
    let panning = false, panX = 0, panY = 0, panLeft = 0, panTop = 0;

    viewportEl.addEventListener("mousedown", ev => {
      if (ev.button === 1) ev.preventDefault();
    });

    viewportEl.addEventListener("pointerdown", ev => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      panning = true;
      panX = ev.clientX;
      panY = ev.clientY;
      panLeft = viewportEl.scrollLeft;
      panTop = viewportEl.scrollTop;
      viewportEl.setPointerCapture(ev.pointerId);
      viewportEl.classList.add("panning");
    });

    viewportEl.addEventListener("pointermove", ev => {
      if (!panning) return;
      viewportEl.scrollLeft = panLeft - (ev.clientX - panX);
      viewportEl.scrollTop = panTop - (ev.clientY - panY);
    });

    function endPan(ev) {
      if (!panning) return;
      panning = false;
      viewportEl.classList.remove("panning");
      if (viewportEl.hasPointerCapture(ev.pointerId)) {
        viewportEl.releasePointerCapture(ev.pointerId);
      }
    }
    viewportEl.addEventListener("pointerup", endPan);
    viewportEl.addEventListener("pointercancel", endPan);
    viewportEl.addEventListener("auxclick", ev => {
      if (ev.button === 1) ev.preventDefault();
    });
  }

  // Ctrl/Cmd + 滚轮缩放，以光标位置为中心
  function bindWheelZoom() {
    viewportEl.addEventListener("wheel", ev => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const oldScale = scale;
      const factor = ev.deltaY < 0 ? 1.1 : 0.9;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
      if (next === oldScale) return;

      const rect = viewportEl.getBoundingClientRect();
      const focusX = ev.clientX - rect.left + viewportEl.scrollLeft;
      const focusY = ev.clientY - rect.top + viewportEl.scrollTop;
      const ratio = next / oldScale;

      scale = next;
      applyScale(+svgEl.getAttribute("width"), +svgEl.getAttribute("height"));
      viewportEl.scrollLeft = focusX * ratio - (ev.clientX - rect.left);
      viewportEl.scrollTop = focusY * ratio - (ev.clientY - rect.top);
    }, { passive: false });
  }

  function bindToolbar() {
    document.getElementById("zoomIn").onclick = () => setScale(scale + 0.1);
    document.getElementById("zoomOut").onclick = () => setScale(scale - 0.1);

    document.getElementById("expandAll").onclick = () => {
      (function walk(n) { n.collapsed = false; (n.children || []).forEach(walk); })(DATA);
      render();
    };
    document.getElementById("collapseAll").onclick = () => {
      (function walk(n, depth) {
        if (depth >= 1 && n.children && n.children.length) n.collapsed = true;
        (n.children || []).forEach(c => walk(c, depth + 1));
      })(DATA, 0);
      render();
    };
  }

  /* ---------- 对外 API ---------- */
  function init(opts) {
    if (initialized) return;
    options = opts || {};

    appEl = document.getElementById("app");
    viewportEl = document.getElementById("viewport");
    stageEl = document.getElementById("stage");
    svgEl = document.getElementById("map");
    splitterEl = document.getElementById("splitter");
    panelEl = document.getElementById("panel");

    prepareData();
    restoreCollapse();
    bindSplitter();
    bindCanvasPan();
    bindWheelZoom();
    bindToolbar();

    initialized = true;
    render();
    updatePanel();
  }

  // 去除空格与顿号，容忍答题页与导图章节名的标点差异
  function norm(s) {
    return String(s).replace(/[\s、，,]/g, "");
  }

  // 深度优先按名称查找节点，用于答题页解析中的知识点直达
  function findNode(root, name) {
    if (norm(root.name) === norm(name)) return root;
    for (const child of root.children || []) {
      const hit = findNode(child, name);
      if (hit) return hit;
    }
    return null;
  }

  function focusChapter(name) {
    if (!initialized) return;
    const target = DATA.children.find(c => norm(c.name) === norm(name));
    if (!target) return;
    target.collapsed = false;
    selected = target;
    render();
    updatePanel();
    viewportEl.scrollLeft = 0;
    const top = target.y * scale - viewportEl.clientHeight / 2;
    viewportEl.scrollTop = Math.max(0, top);
  }

  // 定位到具体知识点：展开所有祖先节点并滚动到该节点
  function focusNode(name) {
    if (!initialized) return;
    const target = findNode(DATA, name);
    if (!target) return focusChapter(name);
    let p = target.parent;
    while (p) {
      p.collapsed = false;
      p = p.parent;
    }
    selected = target;
    render();
    updatePanel();
    const top = target.y * scale - viewportEl.clientHeight / 2;
    const left = target.x * scale - viewportEl.clientWidth / 3;
    viewportEl.scrollTop = Math.max(0, top);
    viewportEl.scrollLeft = Math.max(0, left);
  }

  function refresh() {
    if (!initialized) return;
    render();
  }

  window.MapView = { init, focusChapter, focusNode, refresh };
})();
