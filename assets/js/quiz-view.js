/* 课后练习模块：题库渲染、判题、笔记、统计与导入导出，不感知导图 */
(function () {
  "use strict";

  const QUESTIONS = window.QUIZ_DATA || [];
  const KEY = "cm_quiz_progress_v1";
  const FILE_TAG = "cm-quiz";
  const Store = window.Store;
  // 题型筛选顺序；押题卡片的 section 形如「押题 · 选择题」，其余归入课后题
  const TYPES = ["选择题", "判断题", "简答题", "综合题", "课后题"];

  let options = {};
  let initialized = false;
  let state = {};
  let listEl, selEl, typeEl, segEl;
  let curChapter = "all";
  let curType = "all";
  let curStatus = "all";
  let allAnswersOpen = false;
  const cards = new Map();
  let toastTimer = null;

  /* ---------- 状态存取 ---------- */
  function loadState() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }
  }

  function saveState() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* 隐私模式或本地文件受限时，仅本次会话内保留 */ }
    if (Store) Store.set(KEY, state);   // 同步到本地服务的 SQLite
  }

  // 统一整理记录结构，服务端拉取与 JSON 导入共用
  function normalizeState(incoming) {
    const out = {};
    Object.keys(incoming).forEach(id => {
      const r = incoming[id] || {};
      out[id] = {
        attempts: Number(r.attempts) || 0,
        wrongs: Number(r.wrongs) || 0,
        last: r.last === "right" || r.last === "wrong" ? r.last : null,
        lastAt: r.lastAt || null,
        notes: Array.isArray(r.notes) ? r.notes : [],
        history: Array.isArray(r.history) ? r.history : []
      };
    });
    return out;
  }

  // 启动后拉取服务端记录；服务端为空时把本地已有记录迁移上去
  async function pullServer() {
    if (!Store) return;
    const remote = await Store.get(KEY);
    if (remote && typeof remote === "object" && !Array.isArray(remote)) {
      state = normalizeState(remote);
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      cards.forEach((el, id) => updateCard(id));
      updateStats();
      applyFilter();
    } else {
      Store.set(KEY, state);
    }
  }

  function record(id) {
    if (!state[id]) {
      state[id] = { attempts: 0, wrongs: 0, last: null, lastAt: null, notes: [], history: [] };
    }
    if (!Array.isArray(state[id].notes)) state[id].notes = [];
    if (!Array.isArray(state[id].history)) state[id].history = [];
    return state[id];
  }

  function stat(id) {
    return state[id] || { attempts: 0, wrongs: 0, last: null, lastAt: null, notes: [], history: [] };
  }

  /* ---------- 文本渲染 ---------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // 题型优先取题目自带的 type（作业选择题），其次从 section 推导：押题取「押题 · 」之后的类型，其余视为课后题
  function typeOf(q) {
    if (q.type) return q.type;
    const parts = String(q.section || "").split(" · ");
    return parts[0] === "押题" && parts[1] ? parts[1] : "课后题";
  }

  /* 轻量 Markdown：```代码块``` → <pre>，其余按段落与换行渲染 */
  function renderAnswer(md) {
    if (!md) return "<p>（暂无答案）</p>";
    const parts = md.split(/```/);
    let html = "";
    parts.forEach((seg, i) => {
      if (i % 2 === 1) {
        html += "<pre>" + esc(seg.replace(/^\n|\n$/g, "")) + "</pre>";
        return;
      }
      seg.split(/\n{2,}/).forEach(block => {
        const t = block.trim();
        if (t) html += "<p>" + esc(t).replace(/\n/g, "<br>") + "</p>";
      });
    });
    return html;
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 解析下方的知识点跳转标签，点击直达导图对应节点
  function renderKp(q) {
    const list = typeof options.findNodes === "function" ? options.findNodes(q) : [];
    if (!list.length) return "";
    const chips = list.map(name =>
      `<button class="chip chip-link" data-act="goto-kp" data-kp="${esc(name)}">${esc(String(name).replace(/（[^）]*）/g, ""))}</button>`
    ).join("");
    return `<div class="kp-row"><span class="kp-label">相关知识点：</span>${chips}</div>`;
  }

  /* 来源标签：作业 / 思考题 / 押题 */
  const SOURCE_CLASS = { "作业": "src-work", "思考题": "src-think", "押题": "src-push" };

  /* ---------- 渲染卡片 ---------- */
  function buildCard(q) {
    const el = document.createElement("article");
    el.className = "card";
    el.dataset.id = q.id;
    const source = q.source || "思考题";
    el.innerHTML = `
      <div class="card-top">
        <div class="meta">
          <span class="src ${SOURCE_CLASS[source] || ""}">${esc(source)}</span>
          <button class="chip chip-link" data-act="goto-chapter" data-chapter="${esc(q.chapter)}">${esc(q.chapter)}</button>
          ${q.section ? `<span class="qno">${esc(q.section)}</span>` : ""}
          <span class="qno">第 ${q.no} 题</span>
        </div>
        <div class="badges" data-role="badges"></div>
      </div>
      <p class="stem">${esc(q.q).replace(/\n/g, "<br>")}</p>
      <div class="write">
        <textarea data-role="answertext" placeholder="先写下你的答案，提交后会自动连同判定结果保存为一条作答记录"></textarea>
        <span class="hint">可用 Ctrl/⌘ + Enter 快速提交为「做对」</span>
      </div>
      <div class="actions">
        <button class="btn primary" data-act="reveal" data-pred="${typeOf(q) === "课后题" ? "0" : "1"}">${typeOf(q) === "课后题" ? "显示答案" : "答案"}</button>
        <button class="btn ok" data-act="right">做对了</button>
        <button class="btn bad" data-act="wrong">做错了</button>
      </div>
      <div class="answer" data-role="answer" hidden>
        <span class="ans-tag">参考答案</span>
        ${renderAnswer(q.a)}
        ${renderKp(q)}
      </div>
      <div class="note-box" data-role="notebox" hidden>
        <label>这次错在哪里？（可跳过）</label>
        <textarea data-role="notetext" placeholder="例如：记混了扫描线与边框填充算法的区别……"></textarea>
        <div class="note-actions">
          <button class="btn bad" data-act="savenote">保存笔记</button>
          <button class="btn" data-act="skipnote">跳过</button>
        </div>
      </div>
      <div class="history" data-role="history" hidden>
        <button class="hist-toggle" data-act="togglehist"></button>
        <div class="hist-list" data-role="histlist" hidden></div>
      </div>
      <div class="notes" data-role="notes" hidden></div>
    `;

    el.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = q.id;
      if (act === "reveal") toggleAnswer(id);
      else if (act === "right") mark(id, true);
      else if (act === "wrong") mark(id, false);
      else if (act === "savenote") saveNote(id);
      else if (act === "skipnote") hideNoteBox(id);
      else if (act === "togglehist") toggleHistory(id);
      else if (act === "goto-chapter") {
        if (typeof options.onGoToChapter === "function") options.onGoToChapter(q.chapter);
      } else if (act === "goto-kp") {
        if (typeof options.onGoToNode === "function") options.onGoToNode(btn.dataset.kp);
      } else if (act === "delnote") {
        removeNote(id, btn.dataset.noteid);
      }
    });

    const ta = el.querySelector('[data-role="notetext"]');
    ta.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); saveNote(q.id); }
    });

    const answerTa = el.querySelector('[data-role="answertext"]');
    answerTa.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); mark(q.id, true); }
    });

    cards.set(q.id, el);
    updateCard(q.id);
    return el;
  }

  /* ---------- 卡片交互 ---------- */
  function toggleAnswer(id, force) {
    const el = cards.get(id);
    const ans = el.querySelector('[data-role="answer"]');
    const btn = el.querySelector('[data-act="reveal"]');
    const open = force === undefined ? ans.hidden : force;
    ans.hidden = !open;
    const isPred = btn.dataset.pred === "1";
    btn.textContent = open ? "收起答案" : (isPred ? "答案" : "显示答案");
  }

  function showNoteBox(id) {
    const el = cards.get(id);
    const box = el.querySelector('[data-role="notebox"]');
    box.hidden = false;
    box.querySelector("textarea").focus();
  }

  function hideNoteBox(id) {
    const el = cards.get(id);
    const box = el.querySelector('[data-role="notebox"]');
    box.hidden = true;
    box.querySelector("textarea").value = "";
  }

  function mark(id, ok) {
    const el = cards.get(id);
    const r = record(id);
    const text = el.querySelector('[data-role="answertext"]').value.trim();

    r.attempts += 1;
    r.lastAt = new Date().toISOString();
    r.last = ok ? "right" : "wrong";
    if (!ok) r.wrongs += 1;
    // 每次作答连同用户填写的答案一起入库，形成可回看的作答历史
    r.history.push({ at: r.lastAt, result: r.last, text });
    saveState();
    updateCard(id);
    updateStats();
    if (ok) {
      toggleAnswer(id, false);
      hideNoteBox(id);
      toast("已记录：做对");
    } else {
      toggleAnswer(id, true);
      showNoteBox(id);
      toast("已记录：做错，可写笔记");
    }
  }

  function toggleHistory(id) {
    const el = cards.get(id);
    const list = el.querySelector('[data-role="histlist"]');
    list.hidden = !list.hidden;
  }

  function saveNote(id) {
    const el = cards.get(id);
    const ta = el.querySelector('[data-role="notetext"]');
    const text = ta.value.trim();
    if (!text) { hideNoteBox(id); return; }
    const r = record(id);
    r.notes.push({
      nid: "n" + Date.now(),
      at: new Date().toISOString(),
      text,
      attemptNo: r.wrongs
    });
    saveState();
    ta.value = "";
    hideNoteBox(id);
    updateCard(id);
    toast("笔记已保存");
  }

  function removeNote(id, nid) {
    const r = state[id];
    if (!r) return;
    r.notes = r.notes.filter(n => n.nid !== nid);
    saveState();
    updateCard(id);
  }

  function updateCard(id) {
    const r = stat(id);
    const el = cards.get(id);
    if (!el) return;

    el.classList.toggle("is-right", !!r.attempts && r.last === "right");
    el.classList.toggle("is-wrong", !!r.attempts && r.last === "wrong");

    // 统计徽章
    const badges = el.querySelector('[data-role="badges"]');
    if (r.attempts === 0) {
      badges.innerHTML = '<span class="badge">未练习</span>';
    } else {
      const right = r.attempts - r.wrongs;
      badges.innerHTML = `<span class="badge">作答 ${r.attempts} · 正确 ${right} · 错误 ${r.wrongs}</span>`;
    }

    // 作答记录
    const hist = r.history || [];
    const histBox = el.querySelector('[data-role="history"]');
    const histList = el.querySelector('[data-role="histlist"]');
    const toggleBtn = el.querySelector('[data-act="togglehist"]');
    if (!hist.length) {
      histBox.hidden = true;
      histList.innerHTML = "";
      histList.hidden = true;
    } else {
      histBox.hidden = false;
      toggleBtn.textContent = `作答记录 ${hist.length} 条（点开回看每条回答）`;
      const wasOpen = !histList.hidden;
      histList.innerHTML = hist.slice().reverse().map((h, i) => {
        const no = hist.length - i;
        const tag = h.result === "right"
          ? '<span class="hist-tag ok">做对</span>'
          : '<span class="hist-tag bad">做错</span>';
        const body = h.text
          ? `<div class="hist-text">${esc(h.text)}</div>`
          : '<div class="hist-text empty-text">（本次未填写答案）</div>';
        return `<div class="hist-item">
            <div class="hist-head">${tag}<span>第 ${no} 次 · ${fmtTime(h.at)}</span></div>
            ${body}
          </div>`;
      }).join("");
      histList.hidden = !wasOpen;
    }

    // 笔记列表
    const box = el.querySelector('[data-role="notes"]');
    if (!r.notes || !r.notes.length) {
      box.hidden = true;
      box.innerHTML = "";
    } else {
      box.hidden = false;
      box.innerHTML = r.notes.map(n => `
        <div class="note">
          <div class="note-head">
            <span>第 ${n.attemptNo} 次错误 · ${fmtTime(n.at)}</span>
            <button class="btn ghost" data-act="delnote" data-noteid="${n.nid}">删除</button>
          </div>
          <div class="note-body">${esc(n.text)}</div>
        </div>
      `).join("");
    }
  }

  /* ---------- 统计 ---------- */
  function updateStats() {
    let done = 0, attempts = 0, wrongs = 0;
    QUESTIONS.forEach(q => {
      const r = stat(q.id);
      if (r.attempts > 0) done += 1;
      attempts += r.attempts;
      wrongs += r.wrongs;
    });
    document.getElementById("s-total").textContent = QUESTIONS.length;
    document.getElementById("s-done").textContent = done;
    document.getElementById("s-attempts").textContent = attempts;
    document.getElementById("s-wrongs").textContent = wrongs;
    const rate = attempts ? Math.round((attempts - wrongs) / attempts * 100) + "%" : "—";
    document.getElementById("s-rate").textContent = rate;
  }

  /* ---------- 筛选 ---------- */
  function setStatus(status) {
    curStatus = status;
    segEl.querySelectorAll("button").forEach(b => {
      b.classList.toggle("active", b.dataset.status === status);
    });
  }

  function applyFilter() {
    let visible = 0;
    QUESTIONS.forEach(q => {
      const el = cards.get(q.id);
      const r = stat(q.id);
      let show = (curChapter === "all" || q.chapter === curChapter) &&
        (curType === "all" || typeOf(q) === curType);
      if (show) {
        if (curStatus === "none") show = r.attempts === 0;
        else if (curStatus === "wrong") show = r.wrongs > 0;
        else if (curStatus === "right") show = r.attempts > 0 && r.last === "right";
      }
      el.hidden = !show;
      if (show) visible += 1;
    });

    let empty = document.getElementById("empty-tip");
    if (!visible) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "empty-tip";
        empty.className = "empty";
        empty.textContent = "当前筛选条件下没有题目";
        listEl.appendChild(empty);
      }
      empty.hidden = false;
    } else if (empty) {
      empty.hidden = true;
    }
  }

  /* ---------- 提示条 ---------- */
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
  }

  /* ---------- 导入 / 导出 ---------- */
  function exportRecords() {
    const payload = {
      app: FILE_TAG,
      version: 1,
      exportedAt: new Date().toISOString(),
      state
    };
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    const name = `计算机地图制图-练习记录-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("记录已导出");
  }

  function importRecords(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        toast("导入失败：不是有效的 JSON 文件");
        return;
      }
      const incoming = data && data.state ? data.state : data;
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        toast("导入失败：文件结构不正确");
        return;
      }
      if (!confirm("导入将覆盖当前全部练习记录与笔记，是否继续？")) return;

      state = normalizeState(incoming);
      saveState();
      cards.forEach((el, id) => updateCard(id));
      updateStats();
      applyFilter();
      toast("记录已导入");
    };
    reader.readAsText(file);
  }

  /* ---------- 初始化 ---------- */
  function init(opts) {
    if (initialized) return;
    options = opts || {};
    state = loadState();

    listEl = document.getElementById("list");
    selEl = document.getElementById("chapter");
    typeEl = document.getElementById("qtype");
    segEl = document.getElementById("status-seg");

    const chapters = [...new Set(QUESTIONS.map(q => q.chapter))];
    selEl.innerHTML = '<option value="all">全部章节</option>' +
      chapters.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    selEl.addEventListener("change", () => { curChapter = selEl.value; applyFilter(); });

    const types = TYPES.filter(t => QUESTIONS.some(q => typeOf(q) === t));
    typeEl.innerHTML = '<option value="all">全部题型</option>' +
      types.map(t => `<option value="${t}">${t}</option>`).join("");
    typeEl.addEventListener("change", () => { curType = typeEl.value; applyFilter(); });

    segEl.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      setStatus(btn.dataset.status);
      applyFilter();
    });

    // 一键展开/收起当前筛选结果中的全部答案
    const revealAllBtn = document.getElementById("btn-reveal-all");
    revealAllBtn.addEventListener("click", () => {
      allAnswersOpen = !allAnswersOpen;
      QUESTIONS.forEach(q => {
        const el = cards.get(q.id);
        if (!el || el.hidden) return;
        toggleAnswer(q.id, allAnswersOpen);
      });
      revealAllBtn.textContent = allAnswersOpen ? "收起全部答案" : "展开全部答案";
    });

    document.getElementById("btn-export").addEventListener("click", exportRecords);
    const fileInput = document.getElementById("file-import");
    document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) importRecords(file);
      fileInput.value = "";   // 清空以便重复选择同一文件
    });

    QUESTIONS.forEach(q => listEl.appendChild(buildCard(q)));
    updateStats();
    applyFilter();
    initialized = true;
    pullServer();
  }

  // 去除空格与顿号，容忍导图与题库章节名的标点差异
  function norm(s) {
    return String(s).replace(/[\s、，,]/g, "");
  }

  // 按导图章节名筛选题目，并复位状态筛选
  function jumpToChapter(name) {
    if (!initialized) return;
    const target = QUESTIONS.map(q => q.chapter).find(c => norm(c) === norm(name));
    if (!target) return;
    curChapter = target;
    selEl.value = target;
    curType = "all";
    typeEl.value = "all";
    setStatus("all");
    applyFilter();
    document.getElementById("quizView").scrollTop = 0;
  }

  window.QuizView = { init, jumpToChapter };
})();
