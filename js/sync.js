/* 家庭码同步：本地优先，推送本地全量 → 服务器按 updatedAt 合并 → 拉回覆盖本地。依赖 app.js。 */
"use strict";

const FAMILY_KEY = "health_family_v1";
const DEVICE_KEY = "health_device_v1";
/* 默认同源 /api；本地调试可设 window.API_BASE 指向线上 */
function syncApiBase() {
  return window.API_BASE || "";
}

function getFamily() {
  try {
    return JSON.parse(localStorage.getItem(FAMILY_KEY));
  } catch (e) {
    return null;
  }
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return "苹果手机";
  if (/Android/i.test(ua)) return "安卓手机";
  return "电脑";
}

/* ============ 同步引擎 ============ */
let syncTimer = null;
let syncing = false;

function setSyncStatus(text, ok) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.textContent = text;
  el.className = "sync-status " + (ok ? "sync-ok" : "sync-warn");
}

async function syncNow() {
  const fam = getFamily();
  if (!fam || syncing) return;
  syncing = true;
  try {
    const profile = loadProfile();
    const resp = await fetch(`${syncApiBase()}/api/family/${fam.code}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: loadAllRecords(),
        profile,
        profile_updated_at: profile.updatedAt || 0,
        device_id: deviceId(),
        device_label: deviceLabel(),
      }),
    });
    if (resp.status === 404) {
      setSyncStatus("⚠️ 家庭码已失效，请重新创建或加入", false);
      return;
    }
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();

    localStorage.setItem(STORE_KEY, JSON.stringify(data.records || []));
    const localProfile = loadProfile();
    if (data.profile && (data.profileUpdatedAt || 0) > (localProfile.updatedAt || 0)) {
      saveProfile(data.profile);
    }
    renderFamilyDevices(data.devices || []);
    const t = new Date();
    setSyncStatus(`✅ 已同步到云端 · ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`, true);

    /* 刷新当前可见的列表/图表 */
    if (document.getElementById("tab-history").classList.contains("active")) renderHistory();
    if (document.getElementById("tab-chart").classList.contains("active")) renderCharts();
  } catch (e) {
    console.warn("同步失败", e);
    setSyncStatus("📴 暂时无法连接云端，稍后自动重试（本机记录不受影响）", false);
  } finally {
    syncing = false;
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

/* ============ 界面 ============ */
function renderFamilyUI() {
  const fam = getFamily();
  document.getElementById("family-none").hidden = !!fam;
  document.getElementById("family-joined").hidden = !fam;
  if (fam) {
    document.getElementById("fam-code-box").innerHTML =
      fam.code.split("").map(d => `<b>${d}</b>`).join("");
  }
}

function renderFamilyDevices(devices) {
  const holder = document.getElementById("fam-devices");
  if (!holder || devices.length === 0) return;
  holder.innerHTML = devices.map(d => {
    const mins = Math.round((Date.now() - d.lastSeen) / 60000);
    const when = mins < 2 ? "刚刚" : mins < 60 ? `${mins} 分钟前` : mins < 1440 ? `${Math.round(mins / 60)} 小时前` : `${Math.round(mins / 1440)} 天前`;
    return `<div class="fam-device">📱 ${d.label}<small>${when}使用</small></div>`;
  }).join("");
}

(function initFamilyUI() {
  renderFamilyUI();

  document.getElementById("fam-create").addEventListener("click", async () => {
    try {
      const resp = await fetch(`${syncApiBase()}/api/family`, { method: "POST" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      localStorage.setItem(FAMILY_KEY, JSON.stringify({ code: data.code }));
      renderFamilyUI();
      syncNow();
    } catch (e) {
      console.warn("创建家庭失败", e);
      alert("创建失败：暂时连不上云端，请稍后再试。");
    }
  });

  document.getElementById("fam-join").addEventListener("click", async () => {
    const code = document.getElementById("fam-input").value.trim();
    if (!/^\d{6}$/.test(code)) { alert("请输入 6 位数字家庭码"); return; }
    try {
      const resp = await fetch(`${syncApiBase()}/api/family/${code}`);
      if (resp.status === 404) { alert("没有找到这个家庭码，请核对数字。"); return; }
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      localStorage.setItem(FAMILY_KEY, JSON.stringify({ code }));
      renderFamilyUI();
      await syncNow();
      alert("加入成功！记录已开始同步。");
    } catch (e) {
      console.warn("加入家庭失败", e);
      alert("加入失败：暂时连不上云端，请稍后再试。");
    }
  });

  document.getElementById("fam-sync-now").addEventListener("click", syncNow);

  document.getElementById("fam-leave").addEventListener("click", () => {
    if (!confirm("退出后本机记录保留，但不再和家人互通。确定退出吗？")) return;
    localStorage.removeItem(FAMILY_KEY);
    renderFamilyUI();
  });
})();

/* 各种时机自动同步：启动、保存记录后、回到前台、每 60 秒 */
syncNow();
window.addEventListener("record-saved", scheduleSync);
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
setInterval(syncNow, 60 * 1000);
