/* 健康记录本 —— 纯本地运行，数据保存在浏览器 localStorage */
"use strict";

const STORE_KEY = "health_records_v1";

/* ============ 数据存取 ============ */
function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch (e) {
    console.error("读取数据失败", e);
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORE_KEY, JSON.stringify(records));
}

/* 按日期倒序、同日按时段排序 */
const PERIOD_ORDER = { "早上": 0, "中午": 1, "晚上": 2 };
function sortRecords(records) {
  return records.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (PERIOD_ORDER[a.period] ?? 9) - (PERIOD_ORDER[b.period] ?? 9);
  });
}

function recordsInDays(records, days) {
  if (!days || days <= 0) return records;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutStr = fmtDate(cutoff);
  return records.filter(r => r.date >= cutStr);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ============ 个人信息 ============ */
const PROFILE_KEY = "health_profile_v1";

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
  } catch (e) {
    console.error("读取个人信息失败", e);
    return {};
  }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function profileAge(profile) {
  const y = Number(profile.birthYear);
  if (!y || y < 1900) return null;
  const age = new Date().getFullYear() - y;
  return (age >= 0 && age <= 130) ? age : null;
}

/* ============ 健康评判（按年龄调整，参考国内常用指南） ============ */
const LEVEL_RANK = { ok: 0, warn: 1, high: 2, danger: 3 };

/* 血压：诊断标准 140/90；80 岁及以上控制目标放宽到 150/90 */
function bpLevel(sys, dia, age) {
  if (!sys || !dia) return null;
  if (sys < 90 || dia < 60) return { label: "血压偏低，注意有无头晕乏力", short: "血压偏低", cls: "warn" };
  if (sys >= 160 || dia >= 100) return { label: "血压明显偏高，建议尽快就医", short: "血压过高", cls: "danger" };
  if (sys >= 140 || dia >= 90) {
    if (age != null && age >= 80 && sys < 150 && dia < 90) {
      return { label: "超过一般标准（140/90），但在 80 岁以上控制目标（150/90）内", short: "血压略高", cls: "warn" };
    }
    return { label: "达到高血压标准（≥140/90），请注意", short: "高血压", cls: "high" };
  }
  if (sys >= 120 || dia >= 80) return { label: "血压正常高值，继续观察", short: "血压正常高值", cls: "warn" };
  return { label: "血压正常", short: "血压正常", cls: "ok" };
}

/* 心率：正常 60–100 次/分 */
function pulseLevel(pulse) {
  if (!pulse) return null;
  if (pulse < 50) return { label: "心率明显偏慢，建议就医", short: "心率过慢", cls: "danger" };
  if (pulse < 60) return { label: "心率偏慢（低于 60）", short: "心率偏慢", cls: "warn" };
  if (pulse > 120) return { label: "心率明显偏快，建议就医", short: "心率过快", cls: "danger" };
  if (pulse > 100) return { label: "心率偏快（高于 100）", short: "心率偏快", cls: "warn" };
  return { label: "心率正常", short: "心率正常", cls: "ok" };
}

/* 血糖（mmol/L）：空腹 3.9–6.1 正常，≥7.0 达糖尿病标准；餐后2h <7.8 正常，≥11.1 达糖尿病标准 */
function glucoseLevel(glucose, type) {
  if (!glucose) return null;
  if (glucose < 3.9) return { label: "血糖偏低，请及时进食并留意", short: "血糖偏低", cls: "danger" };
  if (type === "餐后") {
    if (glucose >= 11.1) return { label: "餐后血糖达到糖尿病标准（≥11.1），建议就医", short: "血糖过高", cls: "high" };
    if (glucose >= 7.8) return { label: "餐后血糖偏高（7.8–11.1）", short: "血糖偏高", cls: "warn" };
    return { label: "餐后血糖正常", short: "血糖正常", cls: "ok" };
  }
  if (glucose >= 7.0) return { label: "空腹血糖达到糖尿病标准（≥7.0），建议就医", short: "血糖过高", cls: "high" };
  if (glucose > 6.1) return { label: "空腹血糖偏高（6.1–7.0）", short: "血糖偏高", cls: "warn" };
  return { label: "空腹血糖正常", short: "血糖正常", cls: "ok" };
}

/* 体重：填了身高才按 BMI 评判（正常 18.5–24） */
function bmiLevel(weight, heightCm) {
  if (!weight || !heightCm) return null;
  const h = heightCm / 100;
  const bmi = weight / (h * h);
  if (bmi < 18.5) return { label: `体重偏瘦（BMI ${bmi.toFixed(1)}）`, short: "体重偏瘦", cls: "warn" };
  if (bmi < 24) return { label: `体重正常（BMI ${bmi.toFixed(1)}）`, short: "体重正常", cls: "ok" };
  if (bmi < 28) return { label: `体重超重（BMI ${bmi.toFixed(1)}）`, short: "超重", cls: "warn" };
  return { label: `体重肥胖（BMI ${bmi.toFixed(1)}）`, short: "肥胖", cls: "high" };
}

/* 一条记录的综合评判：全部正常 → 正常；否则列出异常项 */
function assessRecord(r, profile) {
  const age = profileAge(profile);
  const items = [
    bpLevel(r.sys, r.dia, age),
    pulseLevel(r.pulse),
    glucoseLevel(r.glucose, r.glucoseType),
    bmiLevel(r.weight, Number(profile.height) || null),
  ].filter(Boolean);
  if (items.length === 0) return null;
  const bad = items.filter(i => i.cls !== "ok");
  if (bad.length === 0) return { label: "正常", cls: "ok" };
  const worst = bad.reduce((a, b) => LEVEL_RANK[b.cls] > LEVEL_RANK[a.cls] ? b : a);
  return { label: bad.map(i => i.short).join("，"), cls: worst.cls };
}

/* ============ 标签页切换 ============ */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "history") renderHistory();
    if (btn.dataset.tab === "chart") renderCharts();
  });
});

/* ============ 记录表单 ============ */
const form = document.getElementById("record-form");
const fDate = document.getElementById("f-date");
const fSys = document.getElementById("f-sys");
const fDia = document.getElementById("f-dia");
const bpHint = document.getElementById("bp-hint");

fDate.value = fmtDate(new Date());
/* 根据当前时间预选时段 */
(function presetPeriod() {
  const h = new Date().getHours();
  const sel = document.getElementById("f-period");
  sel.value = h < 11 ? "早上" : h < 17 ? "中午" : "晚上";
})();

/* 输入血压时实时提示分级（结合年龄） */
function updateBpHint() {
  const age = profileAge(loadProfile());
  const lv = bpLevel(Number(fSys.value), Number(fDia.value), age);
  if (!lv) { bpHint.hidden = true; return; }
  bpHint.hidden = false;
  bpHint.textContent = lv.label;
  bpHint.className = "bp-hint " + lv.cls;
}
fSys.addEventListener("input", updateBpHint);
fDia.addEventListener("input", updateBpHint);

/* 输入血糖时实时提示 */
function updateGlucoseHint() {
  const hint = document.getElementById("glucose-hint");
  const lv = glucoseLevel(Number(document.getElementById("f-glucose").value),
                          document.getElementById("f-glucose-type").value);
  if (!lv) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.textContent = lv.label;
  hint.className = "bp-hint " + lv.cls;
}
document.getElementById("f-glucose").addEventListener("input", updateGlucoseHint);
document.getElementById("f-glucose-type").addEventListener("change", updateGlucoseHint);

form.addEventListener("submit", e => {
  e.preventDefault();
  const sys = Number(fSys.value) || null;
  const dia = Number(fDia.value) || null;
  const glucose = Number(document.getElementById("f-glucose").value) || null;
  const weight = Number(document.getElementById("f-weight").value) || null;

  if (!sys && !dia && !glucose && !weight) {
    alert("请至少填写一项：血压、血糖或体重");
    return;
  }
  if ((sys && !dia) || (!sys && dia)) {
    alert("血压需要同时填写高压和低压");
    return;
  }

  const rec = {
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    date: fDate.value,
    period: document.getElementById("f-period").value,
    sys, dia,
    pulse: Number(document.getElementById("f-pulse").value) || null,
    glucose,
    glucoseType: glucose ? document.getElementById("f-glucose-type").value : null,
    weight,
    note: document.getElementById("f-note").value.trim() || null,
  };

  const records = loadRecords();
  records.push(rec);
  saveRecords(records);

  /* 清空数值，保留日期时段，提示已保存 */
  ["f-sys", "f-dia", "f-pulse", "f-glucose", "f-weight", "f-note"]
    .forEach(id => { document.getElementById(id).value = ""; });
  bpHint.hidden = true;
  document.getElementById("glucose-hint").hidden = true;
  const msg = document.getElementById("save-msg");
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 2500);
  window.dispatchEvent(new CustomEvent("record-saved"));
});

/* ============ 历史列表 ============ */
function renderHistory() {
  const days = Number(document.getElementById("history-range").value);
  const list = document.getElementById("history-list");
  const records = sortRecords(recordsInDays(loadRecords(), days));

  if (records.length === 0) {
    list.innerHTML = '<p class="empty-tip">这段时间还没有记录，去“记录”页添加吧。</p>';
    return;
  }

  const groups = new Map();
  records.forEach(r => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });

  const profile = loadProfile();
  const age = profileAge(profile);
  let html = "";
  for (const [date, recs] of groups) {
    html += `<div class="day-group"><p class="day-title">${dateLabel(date)}</p>`;
    for (const r of recs) {
      const lv = bpLevel(r.sys, r.dia, age);
      const verdict = assessRecord(r, profile);
      const parts = [];
      if (r.sys) parts.push(`<span class="rec-bp ${lv ? lv.cls : ""}">${r.sys}/${r.dia}</span>`);
      if (r.pulse) parts.push(`<span>心率 ${r.pulse}</span>`);
      if (r.glucose) parts.push(`<span>血糖 ${r.glucose}（${r.glucoseType}）</span>`);
      if (r.weight) parts.push(`<span>体重 ${r.weight}kg</span>`);
      html += `<div class="rec-card">
        <span class="rec-period">${r.period}</span>
        <span class="rec-vals">${parts.join("")}</span>
        ${verdict ? `<span class="verdict-chip ${verdict.cls}">${verdict.label}</span>` : ""}
        <button class="del-btn" data-id="${r.id}">删除</button>
        ${r.note ? `<span class="rec-note">备注：${escapeHtml(r.note)}</span>` : ""}
      </div>`;
    }
    html += "</div>";
  }
  list.innerHTML = html;

  list.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("确定删除这条记录吗？")) return;
      saveRecords(loadRecords().filter(r => r.id !== btn.dataset.id));
      renderHistory();
    });
  });
}
document.getElementById("history-range").addEventListener("change", renderHistory);

function dateLabel(dateStr) {
  const today = fmtDate(new Date());
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const [y, m, d] = dateStr.split("-");
  const base = `${m}月${d}日`;
  if (dateStr === today) return `今天（${base}）`;
  if (dateStr === fmtDate(yest)) return `昨天（${base}）`;
  return `${y}年${base}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ 趋势图（自绘 SVG，离线可用） ============ */
function renderCharts() {
  const days = Number(document.getElementById("chart-range").value);
  const records = recordsInDays(loadRecords(), days)
    .slice().sort((a, b) => (a.date + (PERIOD_ORDER[a.period] ?? 9)) < (b.date + (PERIOD_ORDER[b.period] ?? 9)) ? -1 : 1);

  const bpData = records.filter(r => r.sys && r.dia);
  drawLineChart("bp-chart", bpData, [
    { key: "sys", color: "#c62828", label: "高压" },
    { key: "dia", color: "#1565c0", label: "低压" },
  ], [
    { value: 140, color: "#c62828" },
    { value: 90, color: "#1565c0" },
  ], "还没有血压记录");

  const wData = records.filter(r => r.weight);
  drawLineChart("weight-chart", wData, [
    { key: "weight", color: "#6a4fa3", label: "体重" },
  ], [], "还没有体重记录");
}
document.getElementById("chart-range").addEventListener("change", renderCharts);

function drawLineChart(holderId, data, series, refLines, emptyText) {
  const holder = document.getElementById(holderId);
  if (data.length === 0) {
    holder.innerHTML = `<p class="empty-tip">${emptyText}</p>`;
    return;
  }

  const W = 800, H = 340, padL = 56, padR = 16, padT = 16, padB = 44;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  let vals = [];
  series.forEach(s => { vals = vals.concat(data.map(d => d[s.key]).filter(v => v != null)); });
  refLines.forEach(r => vals.push(r.value));
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const span = Math.max(vMax - vMin, 10);
  vMin = Math.floor((vMin - span * 0.1) / 10) * 10;
  vMax = Math.ceil((vMax + span * 0.1) / 10) * 10;

  const x = i => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = v => padT + plotH - ((v - vMin) / (vMax - vMin)) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;

  /* 纵轴刻度 */
  const step = Math.max(10, Math.round((vMax - vMin) / 5 / 10) * 10);
  for (let v = vMin; v <= vMax; v += step) {
    svg += `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="#eee2d0" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y(v) + 5}" text-anchor="end" font-size="15" fill="#8a7a6a">${v}</text>`;
  }

  /* 横轴日期标签（最多 8 个） */
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));
  data.forEach((d, i) => {
    if (i % tickEvery !== 0 && i !== data.length - 1) return;
    const [, m, dd] = d.date.split("-");
    svg += `<text x="${x(i)}" y="${H - padB + 24}" text-anchor="middle" font-size="14" fill="#8a7a6a">${Number(m)}/${Number(dd)}</text>`;
  });

  /* 参考线 */
  refLines.forEach(r => {
    svg += `<line x1="${padL}" y1="${y(r.value)}" x2="${W - padR}" y2="${y(r.value)}" stroke="${r.color}" stroke-width="1.5" stroke-dasharray="7 5" opacity="0.55"/>`;
  });

  /* 折线与数据点 */
  series.forEach(s => {
    const pts = data.map((d, i) => d[s.key] != null ? `${x(i)},${y(d[s.key])}` : null).filter(Boolean);
    svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round"/>`;
    data.forEach((d, i) => {
      if (d[s.key] == null) return;
      svg += `<circle cx="${x(i)}" cy="${y(d[s.key])}" r="5" fill="${s.color}"/>`;
    });
  });

  svg += "</svg>";
  holder.innerHTML = svg;
}

/* ============ 打印：历史记录表 ============ */
document.getElementById("btn-print-history").addEventListener("click", () => {
  const days = Number(document.getElementById("print-range").value);
  const records = sortRecords(recordsInDays(loadRecords(), days)).reverse(); // 打印按时间正序
  if (records.length === 0) { alert("这段时间没有记录，无法打印。"); return; }

  const profile = loadProfile();
  const age = profileAge(profile);
  let rows = "";
  records.forEach(r => {
    const verdict = assessRecord(r, profile);
    rows += `<tr>
      <td>${r.date}</td><td>${r.period}</td>
      <td>${r.sys ?? ""}</td><td>${r.dia ?? ""}</td><td>${r.pulse ?? ""}</td>
      <td>${r.glucose ? r.glucose + "(" + r.glucoseType + ")" : ""}</td>
      <td>${r.weight ?? ""}</td>
      <td>${verdict ? verdict.label : ""}</td>
      <td style="text-align:left">${r.note ? escapeHtml(r.note) : ""}</td>
    </tr>`;
  });

  const who = [];
  if (profile.name) who.push(`姓名：${escapeHtml(profile.name)}`);
  if (age != null) who.push(`年龄：${age} 岁`);
  const rangeText = days > 0 ? `最近 ${days} 天` : "全部记录";
  printHtml(`<div class="print-page">
    <h1 class="print-title">健康记录表</h1>
    <p class="print-sub">${who.length ? who.join(" ｜ ") + " ｜ " : ""}${rangeText} ｜ 打印日期：${fmtDate(new Date())} ｜ 共 ${records.length} 条</p>
    <table class="print-table">
      <tr><th>日期</th><th>时段</th><th>高压</th><th>低压</th><th>心率</th><th>血糖<br>mmol/L</th><th>体重<br>kg</th><th>评估</th><th>备注</th></tr>
      ${rows}
    </table>
    <p class="print-footnote">血压单位 mmHg。评估按年龄参考国内常用指南（一般高血压 ≥140/90，80 岁以上控制目标 150/90），仅供参考，请遵医嘱。</p>
  </div>`);
});

/* ============ 打印：空白手写模板（每页一周） ============ */
document.getElementById("btn-print-blank").addEventListener("click", () => {
  const weeks = Number(document.getElementById("blank-weeks").value);
  const profile = loadProfile();
  const nameSlot = profile.name ? escapeHtml(profile.name) : "__________";
  let pages = "";
  for (let w = 0; w < weeks; w++) {
    let rows = "";
    const dayNames = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
    dayNames.forEach(day => {
      ["早上", "晚上"].forEach((p, i) => {
        rows += `<tr>
          ${i === 0 ? `<td rowspan="2" style="width:12%">${day}<br>____月____日</td>` : ""}
          <td style="width:8%">${p}</td>
          <td></td><td></td><td></td><td></td><td></td><td></td>
        </tr>`;
      });
    });
    pages += `<div class="print-page">
      <h1 class="print-title">健康手写记录表（第 ${w + 1} 周）</h1>
      <p class="print-sub">姓名：${nameSlot} ｜ 起始日期：______年____月____日</p>
      <table class="print-table blank-table">
        <tr><th>日期</th><th>时段</th><th>高压<br>mmHg</th><th>低压<br>mmHg</th><th>心率<br>次/分</th><th>血糖<br>mmol/L</th><th>体重<br>kg</th><th>备注</th></tr>
        ${rows}
      </table>
      <p class="print-footnote">提示：量血压前静坐 5 分钟；早上起床后、晚上睡觉前各量一次。高压≥140 或低压≥90 请咨询医生。</p>
    </div>`;
  }
  printHtml(pages);
});

function printHtml(html) {
  document.getElementById("print-area").innerHTML = html;
  window.print();
}

/* ============ CSV 导出 / 导入 ============ */
const CSV_HEADER = "日期,时段,高压,低压,心率,血糖,血糖类型,体重,备注";

document.getElementById("btn-export").addEventListener("click", () => {
  const records = sortRecords(loadRecords()).reverse();
  if (records.length === 0) { alert("还没有数据可以导出。"); return; }
  const lines = records.map(r =>
    [r.date, r.period, r.sys ?? "", r.dia ?? "", r.pulse ?? "",
     r.glucose ?? "", r.glucoseType ?? "", r.weight ?? "",
     r.note ? '"' + r.note.replace(/"/g, '""') + '"' : ""].join(","));
  /* ﻿ 让 Excel 正确识别中文 */
  const blob = new Blob(["﻿" + CSV_HEADER + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `健康记录_${fmtDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = reader.result.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
      const records = loadRecords();
      let added = 0;
      lines.slice(1).forEach(line => {
        const c = parseCsvLine(line);
        if (c.length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0])) return;
        records.push({
          id: Date.now() + "_" + Math.random().toString(36).slice(2, 7) + added,
          date: c[0], period: c[1] || "早上",
          sys: Number(c[2]) || null, dia: Number(c[3]) || null, pulse: Number(c[4]) || null,
          glucose: Number(c[5]) || null, glucoseType: c[6] || null,
          weight: Number(c[7]) || null, note: c[8] || null,
        });
        added++;
      });
      saveRecords(records);
      alert(`导入完成，共添加 ${added} 条记录。`);
    } catch (err) {
      console.error("导入失败", err);
      alert("导入失败，请确认文件是本应用导出的 CSV。");
    }
    e.target.value = "";
  };
  reader.readAsText(file, "utf-8");
});

/* ============ 个人信息表单 ============ */
(function initProfileForm() {
  const pName = document.getElementById("p-name");
  const pBirth = document.getElementById("p-birth");
  const pHeight = document.getElementById("p-height");
  const ageTip = document.getElementById("profile-age");

  const profile = loadProfile();
  if (profile.name) pName.value = profile.name;
  if (profile.birthYear) pBirth.value = profile.birthYear;
  if (profile.height) pHeight.value = profile.height;

  function updateAgeTip() {
    const age = profileAge({ birthYear: Number(pBirth.value) });
    if (age == null) { ageTip.hidden = true; return; }
    ageTip.hidden = false;
    ageTip.textContent = `今年 ${age} 岁` + (age >= 80 ? "，血压控制目标按 150/90 以内评判" : "，血压按一般标准（140/90）评判");
  }
  pBirth.addEventListener("input", updateAgeTip);
  updateAgeTip();

  document.getElementById("profile-form").addEventListener("submit", e => {
    e.preventDefault();
    const birthYear = Number(pBirth.value) || null;
    if (pBirth.value && profileAge({ birthYear }) == null) {
      alert("出生年份看起来不对，请检查（如 1950）");
      return;
    }
    saveProfile({
      name: pName.value.trim() || null,
      birthYear,
      height: Number(pHeight.value) || null,
    });
    updateBpHint();
    const msg = document.getElementById("profile-msg");
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, 2500);
  });
})();

function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
