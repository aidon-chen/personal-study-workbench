/* 应用编排：标签切换与两个模块之间的双向章节联动，不含业务细节 */
(function () {
  "use strict";

  const mapView = document.getElementById("mapView");
  const quizView = document.getElementById("quizView");
  const mapTools = document.getElementById("mapTools");
  const tabMap = document.getElementById("tabMap");
  const tabQuiz = document.getElementById("tabQuiz");
  const appHint = document.getElementById("appHint");

  const HINTS = {
    map: "点击节点查看详情；选中右侧文字可高亮、圈划并写批注；＋/− 展开收起；拖动竖条调整面板宽度；中键拖动画布；Ctrl＋滚轮缩放",
    quiz: "先自己作答，再展开参考答案；点击题目上的章节标签可回到知识图谱"
  };

  // 押题解析涉及的知识点，人工核对后直接指定导图节点；其余题目按关键词匹配本章节点
  const KP_OVERRIDE = {
    y01: ["核心：图形与数字互转（P17）"],
    y02: ["图形：矢量、算法描述（P12）", "图像：位图、像素点阵（P12）"],
    y03: ["系统五大功能", "计算与存储（P6）"],
    y04: ["栅格法：像素矩阵（P8）", "矢量法：短直线逼近（P9）"],
    y05: ["WCS 到 DCS 映射（P12）", "NDCS 取值 0~1（P8）"],
    y06: ["直线 Bresenham"],
    y07: ["信息块法（P4）", "程序块法（P4）", "综合法（P4）"],
    y08: ["编码规则（P7-8）", "判断三条规则（P9）"],
    y09: ["Gouraud 光强插值（P10）", "Phong 法线插值（P10）"],
    y10: ["与 CAD 相同点（P18）", "制图：大地坐标系（P18）"],
    y11: ["随机扫描：优缺点（P19）", "存储管式：优缺点（P20）", "光栅扫描：优缺点（P21-23）"],
    y12: ["分类：矢量型与光栅型（P10）", "绘图仪与胶片输出（P33-35）"],
    y13: ["DCS 设备坐标系（P6）", "屏幕坐标系（P7）"],
    y14: ["射线法（P29）", "夹角求和法（P29）"],
    y15: ["直线 DDA", "直线 Bresenham"],
    y16: ["种子填充 4/8 连通（P61-62）"],
    y17: ["四个特点（P7）", "三个特点（P25）"],
    y18: ["中点分割思想（P11-12）"],
    y19: ["对象与图像空间（P6）", "线消隐与面消隐（P7）"],
    y20: ["扫描线四步（P50）", "有效边表结构（P54-55）"],
    y21: ["点阵字符特点（P66）", "矢量字符特点（P67）", "轮廓字形优点（P68）"],
    y22: ["点图形属性（P15-16）", "点在线段判定（P28）", "射线法（P29）"],
    y23: ["点图形填充五法（P26-28）", "颜色与图案填充（P26）"],
    y24: ["旋转变换（P32）", "五种对称变换（P36-38）", "复合变换性质（P41）"]
  };

  const STOP_WORDS = /^(图形|地图|数据|方法|特点|内容|类型|基本|主要|关系|定义|一般|原理|算法|概念|过程|结构)$/;

  // 收集导图全部节点，用于答题页「相关知识点」跳转
  const KP_NODES = [];
  (MAP_DATA.children || []).forEach(chapter => {
    (function walk(node, depth) {
      (node.children || []).forEach(child => {
        KP_NODES.push({ name: child.name, chapter: chapter.name, depth: depth + 1 });
        walk(child, depth + 1);
      });
    })(chapter, 1);
  });

  const plainName = s => String(s).replace(/（[^）]*）/g, "");
  const kpKeywords = name => plainName(name)
    .split(/[：:、，,；;（）()\s/]/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && !STOP_WORDS.test(s));

  // 最长公共子串长度，用于容忍表述差异（如「点阵字符与矢量字符」）
  function lcsLen(a, b) {
    let best = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        let k = 0;
        while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
        if (k > best) best = k;
      }
    }
    return best;
  }

  // 返回题目关联的导图节点名：优先人工映射，否则取本章关键词得分最高的两个节点
  function findNodes(q) {
    if (Array.isArray(q.kp) && q.kp.length) return q.kp;
    if (KP_OVERRIDE[q.id]) return KP_OVERRIDE[q.id];
    const text = q.q + " " + q.a;
    const stem = q.q;
    const scored = [];
    KP_NODES.filter(n => n.chapter === q.chapter && n.depth >= 2).forEach(n => {
      let score = 0;
      kpKeywords(n.name).forEach(k => {
        if (stem.includes(k)) score += k.length * 3;
        else if (text.includes(k)) score += k.length;
      });
      const lcs = lcsLen(plainName(n.name), stem);
      if (lcs >= 4) score += lcs * 2;
      if (score >= 6) scored.push({ score, name: n.name });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 2).map(x => x.name);
  }

  function setView(name) {
    const isMap = name === "map";
    mapView.hidden = !isMap;
    quizView.hidden = isMap;
    mapTools.hidden = !isMap;
    tabMap.classList.toggle("active", isMap);
    tabQuiz.classList.toggle("active", !isMap);
    appHint.textContent = isMap ? HINTS.map : HINTS.quiz;
    if (isMap) MapView.refresh();
  }

  // 右侧详情批注：先在面板外初始化工具栏，再由 map-view 每次重绘后回调挂载
  if (window.PanelAnnotate) PanelAnnotate.init();

  MapView.init({
    onPracticeChapter: name => {
      setView("quiz");
      QuizView.jumpToChapter(name);
    },
    onPanelReady: (node, body) => {
      if (window.PanelAnnotate) PanelAnnotate.mount(node, body);
    }
  });

  QuizView.init({
    onGoToChapter: name => {
      setView("map");
      MapView.focusChapter(name);
    },
    onGoToNode: name => {
      setView("map");
      MapView.focusNode(name);
    },
    findNodes
  });

  tabMap.addEventListener("click", () => setView("map"));
  tabQuiz.addEventListener("click", () => setView("quiz"));
  setView("map");
})();
