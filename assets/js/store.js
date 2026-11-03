/*
 * 存储适配器：优先写入本地服务（SQLite），服务不可用时退回浏览器 localStorage
 * 对外只暴露 Store.get(key) / Store.set(key, value)，均为 Promise
 */
(function () {
  "use strict";

  // file:// 打开时没有 HTTP 接口，直接用浏览器本地存储
  const online = location.protocol === "http:" || location.protocol === "https:";

  async function get(key) {
    if (online) {
      try {
        const res = await fetch("/api/store/" + encodeURIComponent(key), { cache: "no-store" });
        if (res.ok) return await res.json();
      } catch (e) { /* 服务未启动，降级到本地 */ }
    }
    try { return JSON.parse(localStorage.getItem(key)); }
    catch (e) { return null; }
  }

  async function set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { /* 隐私模式下仅本次会话有效 */ }

    if (!online) return;
    try {
      await fetch("/api/store/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      });
    } catch (e) { /* 写入失败时保留本地副本，下次打开仍可读取 */ }
  }

  window.Store = { get, set, online };
})();
