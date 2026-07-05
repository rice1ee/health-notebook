/* 测量提醒：早/晚到点未记录时弹通知 + 页面顶部横幅。依赖 app.js 的全局函数。 */
"use strict";

const REMINDER_KEY = "health_reminder_v1";
const REMINDER_DEFAULTS = { enabled: false, morning: "07:00", evening: "19:00" };

function loadReminder() {
  try {
    return Object.assign({}, REMINDER_DEFAULTS, JSON.parse(localStorage.getItem(REMINDER_KEY)) || {});
  } catch (e) {
    console.error("读取提醒设置失败", e);
    return Object.assign({}, REMINDER_DEFAULTS);
  }
}

function saveReminder(settings) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(settings));
}

/* 今天某时段是否已有记录 */
function todayHasPeriod(period) {
  const today = fmtDate(new Date());
  return loadRecords().some(r => r.date === today && r.period === period);
}

/* 发通知：优先走 Service Worker（安卓上必须），退回页面通知 */
async function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: "health-reminder" });
      return true;
    }
  } catch (e) {
    console.warn("SW 通知失败，改用页面通知", e);
  }
  try {
    new Notification(title, { body, icon: "icon-192.png" });
    return true;
  } catch (e) {
    console.warn("通知发送失败", e);
    return false;
  }
}

/* ============ 定时调度（应用开着时到点触发） ============ */
let reminderTimer = null;

function parseTimeToday(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/* 计算下一次提醒：{time, period}，全关则 null */
function nextReminder(settings) {
  if (!settings.enabled) return null;
  const now = new Date();
  const candidates = [
    { time: parseTimeToday(settings.morning), period: "早上" },
    { time: parseTimeToday(settings.evening), period: "晚上" },
  ];
  const upcoming = candidates.filter(c => c.time > now).sort((a, b) => a.time - b.time);
  if (upcoming.length > 0) return upcoming[0];
  const tomorrow = candidates.sort((a, b) => a.time - b.time)[0];
  tomorrow.time = new Date(tomorrow.time.getTime() + 24 * 3600 * 1000);
  return tomorrow;
}

function scheduleReminder() {
  if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
  const next = nextReminder(loadReminder());
  if (!next) return;
  const delay = Math.max(1000, next.time - new Date());
  /* setTimeout 上限约 24.8 天，这里最多 24 小时，安全 */
  reminderTimer = setTimeout(() => {
    if (!todayHasPeriod(next.period)) {
      notify("该量血压啦 🩺", `${next.period}还没记录，量好后打开“健康记录本”记一笔。`);
    }
    updateReminderBanner();
    scheduleReminder();
  }, delay);
}

/* ============ 页面顶部横幅 ============ */
function updateReminderBanner() {
  const banner = document.getElementById("reminder-banner");
  const s = loadReminder();
  if (!s.enabled) { banner.hidden = true; return; }
  const now = new Date();
  let missing = null;
  if (now >= parseTimeToday(s.morning) && !todayHasPeriod("早上")) missing = "早上";
  if (!missing && now >= parseTimeToday(s.evening) && !todayHasPeriod("晚上")) missing = "晚上";
  if (!missing) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.textContent = `⏰ 今天${missing}还没记录血压，点这里去记一笔`;
  banner.onclick = () => document.querySelector('.tab-btn[data-tab="record"]').click();
}

/* ============ 设置界面 ============ */
(function initReminderUI() {
  const rEnabled = document.getElementById("r-enabled");
  const rMorning = document.getElementById("r-morning");
  const rEvening = document.getElementById("r-evening");
  const rStatus = document.getElementById("r-status");

  const s = loadReminder();
  rEnabled.checked = s.enabled;
  rMorning.value = s.morning;
  rEvening.value = s.evening;
  showPermissionStatus();

  function showPermissionStatus() {
    if (!("Notification" in window)) {
      rStatus.textContent = "当前浏览器不支持通知，横幅提醒仍然有效。";
      return;
    }
    if (Notification.permission === "denied") {
      rStatus.textContent = "通知权限被拒绝了。请在手机的浏览器设置里允许本站通知，横幅提醒不受影响。";
    } else if (Notification.permission === "granted") {
      rStatus.textContent = loadReminder().enabled ? "提醒已开启 ✅" : "";
    } else {
      rStatus.textContent = "";
    }
  }

  async function persist() {
    saveReminder({ enabled: rEnabled.checked, morning: rMorning.value || "07:00", evening: rEvening.value || "19:00" });
    scheduleReminder();
    updateReminderBanner();
    showPermissionStatus();
  }

  rEnabled.addEventListener("change", async () => {
    if (rEnabled.checked && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    persist();
  });
  rMorning.addEventListener("change", persist);
  rEvening.addEventListener("change", persist);

  document.getElementById("r-test").addEventListener("click", async () => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
      showPermissionStatus();
    }
    const ok = await notify("通知测试 ✅", "看到这条就说明提醒能正常弹出。");
    if (!ok) alert("通知没能弹出：请先在浏览器/手机设置里允许本站通知。");
  });
})();

/* 启动 + 各种时机刷新横幅 */
scheduleReminder();
updateReminderBanner();
window.addEventListener("record-saved", updateReminderBanner);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { updateReminderBanner(); scheduleReminder(); }
});
setInterval(updateReminderBanner, 60 * 1000);
