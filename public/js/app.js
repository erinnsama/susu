import { api, ApiError } from "./api.js";

var PALETTE = ["#DE5D83","#3E7FC4","#3F9A5D","#E0A23E","#8B7CC0","#3EA8A0","#C1432E","#8C93A6"];
var STATUSES = ["todo","doing","done"];
var PRIORITY_RANK = {high:0, normal:1, low:2};

var projects = [];
var tasks = [];
var activeFilter = null;
var activeStatFilter = null;
var editingTaskId = null;
var editingStatusPreset = "todo";
var taskStatusValue = "todo";
var taskPriorityValue = "normal";
var newProjColor = PALETTE[0];
var reportMode = "month";

var $ = function(id){ return document.getElementById(id); };

function dateStr(d){
  var y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
function todayStr(){ return dateStr(new Date()); }
function tomorrowStr(){
  var d = new Date();
  d.setDate(d.getDate()+1);
  return dateStr(d);
}
// completedAt/createdAt 是伺服器存的 UTC ISO 字串，拿來跟「今天」比對日期區間時
// 要先轉成使用者所在時區（她都在台北）的在地日期，不然晚上的紀錄會被歸到隔天的 UTC 日期去。
function localDateStr(iso){
  return iso ? dateStr(new Date(iso)) : null;
}
function fmtToday(){
  var d = new Date();
  var wk = ["日","一","二","三","四","五","六"][d.getDay()];
  return todayStr().replace(/-/g,"/") + "（" + wk + "）";
}
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ t.hidden = true; }, 2600);
}
function reduceMotion(){
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- data ---------- */
async function loadAll(){
  var results = await Promise.all([api.listProjects(), api.listTasks()]);
  projects = results[0];
  tasks = results[1];
  render();
}

function handleError(err){
  if(err instanceof ApiError && (err.status===401 || err.status===403)){
    toast(err.message + "，正在帶妳回登入頁…");
    setTimeout(function(){ location.reload(); }, 1800);
    return;
  }
  toast(err && err.message ? err.message : "操作失敗，請再試一次");
}

// 每個寫入動作都吃掉例外並跳提示，否則失敗時畫面完全沒反應，會以為是當掉
function run(promise){
  return promise.then(loadAll).catch(function(err){ handleError(err); });
}

var store = {
  addProject: function(data){ return run(api.addProject(data)); },
  updateProject: function(id, patch){ return run(api.updateProject(id, patch)); },
  deleteProject: function(id){ return run(api.deleteProject(id)); },
  addTask: function(data){ return run(api.addTask(data)); },
  updateTask: function(id, patch){ return run(api.updateTask(id, patch)); },
  deleteTask: function(id){ return run(api.deleteTask(id)); }
};

/* ---------- boot ---------- */
function boot(){
  $("todayLabel").textContent = fmtToday();
  bindStaticHandlers();
  render();
  loadAll().catch(handleError);
  showWhoAmI();
  initPush();
  // 手機把應用程式放到背景很久再切回來時，記憶體裡的 tasks 可能是很久以前載入的舊資料；
  // 如果這時候編輯任務儲存，會把舊資料的截止日期整包送回去，把其他裝置後來改過的日期蓋回舊值。
  // 每次切回前景就重新抓一次，降低這個「日期又跳回去」的機率。
  document.addEventListener("visibilitychange", function(){
    if(!document.hidden) loadAll().catch(handleError);
  });
}

function showWhoAmI(){
  var chip = $("userChip");
  if(!chip) return;
  api.me().then(function(me){
    chip.hidden = false;
    $("userEmail").textContent = me.email || me.name || "";
  }).catch(function(){
    // 登入資訊拿不到就單純不顯示，loadAll 已經會報錯了
  });
}

/* ---------- 推播提醒 ---------- */
// VAPID 公鑰是 base64url，PushManager.subscribe 要吃 Uint8Array
function urlBase64ToUint8Array(base64String){
  var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  var raw = atob(base64);
  var out = new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(){
  return "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
}
// iOS Safari 只有從「加到主畫面」的圖示打開時，推播 API 才真的能用；
// 直接開網頁分頁的話 PushManager 存在但 subscribe 會直接失敗。
function isStandalone(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
// 只有 iOS Safari 規定「一定要從主畫面圖示開才能訂閱推播」，
// 桌機瀏覽器、Android 一般分頁就能訂閱，不該被這個限制擋到
function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
// Service Worker 要在頁面一載入就註冊，不能等使用者先「安裝」才註冊——
// 瀏覽器判斷「這個網站可以安裝成應用程式」的條件之一就是要有已註冊的 Service Worker，
// 等安裝完才註冊就變成先有雞還是先有蛋，安裝按鈕永遠不會出現。
function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js").catch(function(){ return null; });
}

function setPushUi(state, label){
  var btn = $("pushToggleBtn");
  var hint = $("pushHint");
  var testBtn = $("pushTestBtn");
  if(!btn) return;
  if(state==="hide"){
    btn.hidden = true;
    hint.hidden = true;
    testBtn.hidden = true;
    return;
  }
  if(state==="hint"){
    btn.hidden = true;
    hint.hidden = false;
    hint.textContent = label;
    testBtn.hidden = true;
    return;
  }
  btn.hidden = false;
  hint.hidden = true;
  btn.setAttribute("data-on", state==="on" ? "1" : "0");
  $("pushToggleLabel").textContent = label;
  testBtn.hidden = state!=="on";
}

function initPush(){
  registerServiceWorker();
  if(!pushSupported()){
    setPushUi("hide");
    return;
  }
  if(isIOS() && !isStandalone()){
    setPushUi("hint", "把這個網站加到主畫面，並從主畫面圖示打開，才能設定推播提醒");
    return;
  }
  if(Notification.permission === "denied"){
    setPushUi("hint", "推播權限已被封鎖，請到系統設定重新允許通知");
    return;
  }
  navigator.serviceWorker.ready.then(function(reg){
    return reg.pushManager.getSubscription();
  }).then(function(sub){
    setPushUi(sub ? "on" : "off", sub ? "推播提醒已開啟" : "開啟推播提醒");
  }).catch(function(){
    setPushUi("hide");
  });
}

function togglePush(){
  var btn = $("pushToggleBtn");
  var isOn = btn.getAttribute("data-on")==="1";
  if(isOn) return unsubscribePush();
  return subscribePush();
}

function subscribePush(){
  Notification.requestPermission().then(function(perm){
    if(perm!=="granted"){
      setPushUi("hint", "沒有允許通知，推播提醒無法開啟");
      return null;
    }
    return Promise.all([navigator.serviceWorker.ready, api.config()]).then(function(r){
      var reg = r[0], cfg = r[1];
      if(!cfg.vapidPublicKey) throw new Error("伺服器尚未設定推播金鑰");
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
      });
    }).then(function(sub){
      return api.pushSubscribe(sub.toJSON());
    }).then(function(){
      setPushUi("on", "推播提醒已開啟");
      toast("推播提醒已開啟");
    });
  }).catch(function(err){
    handleError(err);
  });
}

function unsubscribePush(){
  navigator.serviceWorker.ready.then(function(reg){
    return reg.pushManager.getSubscription();
  }).then(function(sub){
    if(!sub) return;
    var endpoint = sub.endpoint;
    return sub.unsubscribe().then(function(){ return api.pushUnsubscribe(endpoint); });
  }).then(function(){
    setPushUi("off", "開啟推播提醒");
    toast("推播提醒已關閉");
  }).catch(function(err){
    handleError(err);
  });
}

function sendTestPush(){
  var btn = $("pushTestBtn");
  btn.disabled = true;
  api.pushTest().then(function(res){
    var outcomes = (res && res.outcomes) || [];
    var okCount = outcomes.filter(function(o){ return o.ok; }).length;
    if(!outcomes.length) toast("目前沒有已訂閱的裝置");
    else if(okCount>0) toast("測試推播已送出，等一下看看有沒有跳通知");
    else toast("送出失敗："+(outcomes[0] && outcomes[0].error || "未知錯誤"));
  }).catch(function(err){
    handleError(err);
  }).then(function(){
    btn.disabled = false;
  });
}

/* ---------- derived data ---------- */
function visibleProjects(){
  return projects.filter(function(p){ return !p.archived; });
}
function projectById(id){
  for(var i=0;i<projects.length;i++){ if(projects[i].id===id) return projects[i]; }
  return null;
}
function matchesStatFilter(t){
  if(!activeStatFilter) return true;
  var t0 = todayStr();
  if(activeStatFilter==="today") return t.dueDate===t0 && t.status!=="done";
  if(activeStatFilter==="overdue") return t.dueDate && t.dueDate<t0 && t.status!=="done";
  if(activeStatFilter==="doing") return t.status==="doing";
  if(activeStatFilter==="open") return t.status!=="done";
  return true;
}
function filteredTasks(){
  return tasks.filter(function(t){
    if(activeFilter && t.projectId!==activeFilter) return false;
    return matchesStatFilter(t);
  });
}
function sortTasks(list){
  return list.slice().sort(function(a,b){
    var pa = PRIORITY_RANK[a.priority]!=null?PRIORITY_RANK[a.priority]:1;
    var pb = PRIORITY_RANK[b.priority]!=null?PRIORITY_RANK[b.priority]:1;
    if(pa!==pb) return pa-pb;
    var da = a.dueDate || "9999-99-99", db_ = b.dueDate || "9999-99-99";
    if(da!==db_) return da<db_?-1:1;
    return (a.createdAt||"").localeCompare(b.createdAt||"");
  });
}

/* ---------- render ---------- */
function render(){
  renderStats();
  renderChips();
  renderBoard();
  renderTodayBadge();
  if(!$("todayOverlay").hidden) renderTodaySheet();
  if(!$("reportOverlay").hidden) renderReportSheet();
}

/* ---------- 今日任務 ---------- */
// 「今日任務」＝截止日是今天且還沒完成的任務，
// 跟「今天到期」統計、推播提醒共用同一份資料，不會各算各的。
function todayTasks(){
  var t = todayStr();
  return tasks.filter(function(x){ return x.dueDate===t && x.status!=="done"; });
}
function renderTodayBadge(){
  $("todayCount").textContent = todayTasks().length;
}

function todayRowHtml(t, action){
  var p = projectById(t.projectId);
  var color = p ? p.color : "#8C93A6";
  var name = p ? p.name : "未分類";
  var statusLabel = {todo:"待辦", doing:"進行中", done:"已完成"}[t.status] || t.status;
  var actions = action==="add"
    ? '<button type="button" class="today-btn add" data-add-today="'+t.id+'" aria-label="加入今日任務">＋</button>'
    : (
        '<button type="button" class="today-btn done" data-done-today="'+t.id+'" aria-label="標記已完成">✓</button>'+
        '<button type="button" class="today-btn postpone" data-postpone-today="'+t.id+'" aria-label="延到明天">→</button>'+
        '<button type="button" class="today-btn remove" data-remove-today="'+t.id+'" aria-label="移出今日任務">－</button>'
      );
  return (
    '<div class="today-row">'+
      '<span class="dot" style="background:'+color+'"></span>'+
      '<div class="today-meta">'+
        '<span class="today-title">'+escapeHtml(t.title)+'</span>'+
        '<span class="today-sub">'+escapeHtml(name)+' · '+statusLabel+
          (t.priority==="high" ? ' · <b class="urgent-text">急</b>' : '')+
          (action==="add" && t.dueDate ? ' · 原訂 '+t.dueDate.slice(5).replace("-","/") : '')+
        '</span>'+
      '</div>'+
      '<div class="today-actions">'+actions+'</div>'+
    '</div>'
  );
}

function renderTodaySheet(){
  var t0 = todayStr();
  $("todayDateLabel").textContent = fmtToday();

  var mine = sortTasks(todayTasks());
  $("todayNowCount").textContent = mine.length;
  $("todayList").innerHTML = mine.length
    ? mine.map(function(t){ return todayRowHtml(t, "remove"); }).join("")
    : '<div class="empty-slot">今天還沒有排任務，從下面挑幾個吧</div>';

  var keyword = ($("todaySearch").value || "").trim().toLowerCase();
  var pool = sortTasks(tasks.filter(function(x){
    if(x.status==="done") return false;
    if(x.dueDate===t0) return false;
    if(keyword && x.title.toLowerCase().indexOf(keyword)===-1) return false;
    return true;
  }));
  $("todayPool").innerHTML = pool.length
    ? pool.map(function(t){ return todayRowHtml(t, "add"); }).join("")
    : '<div class="empty-slot">'+(keyword ? "沒有符合的任務" : "所有未完成的任務都已經在今天了")+'</div>';

  $("todayList").querySelectorAll("[data-remove-today]").forEach(function(btn){
    btn.addEventListener("click", function(){
      store.updateTask(btn.getAttribute("data-remove-today"), {dueDate:null}).then(renderTodaySheet);
    });
  });
  $("todayList").querySelectorAll("[data-done-today]").forEach(function(btn){
    btn.addEventListener("click", function(){
      store.updateTask(btn.getAttribute("data-done-today"), {status:"done"}).then(renderTodaySheet);
    });
  });
  $("todayList").querySelectorAll("[data-postpone-today]").forEach(function(btn){
    btn.addEventListener("click", function(){
      store.updateTask(btn.getAttribute("data-postpone-today"), {dueDate:tomorrowStr()}).then(renderTodaySheet);
    });
  });
  $("todayPool").querySelectorAll("[data-add-today]").forEach(function(btn){
    btn.addEventListener("click", function(){
      store.updateTask(btn.getAttribute("data-add-today"), {dueDate:todayStr()}).then(renderTodaySheet);
    });
  });
}

function openTodaySheet(){
  $("todaySearch").value = "";
  renderTodaySheet();
  $("todayOverlay").hidden = false;
}
function closeTodaySheet(){ $("todayOverlay").hidden = true; }

/* ---------- 工作回顧 ---------- */
// 月：本月 1 號到今天。半年：含本月在內往前推 6 個整月的 1 號到今天。
// 兩種都用「本地日曆月份」切，不是滾動 30/180 天，這樣「本月」才會跟她腦中想的月份對得上。
function reportRange(mode){
  var now = new Date();
  if(mode==="halfyear"){
    var start6 = new Date(now.getFullYear(), now.getMonth()-5, 1);
    return {startStr:dateStr(start6), endStr:todayStr()};
  }
  var start1 = new Date(now.getFullYear(), now.getMonth(), 1);
  return {startStr:dateStr(start1), endStr:todayStr()};
}
function inRange(s, range){ return s!=null && s>=range.startStr && s<=range.endStr; }

// 本月拆成每週（1-7/8-14/...），半年拆成 6 個日曆月，兩種都是「完成數」當柱子高度。
function reportBuckets(mode, range){
  var buckets = [];
  if(mode==="halfyear"){
    var now = new Date();
    for(var i=5;i>=0;i--){
      var m = new Date(now.getFullYear(), now.getMonth()-i, 1);
      var mEnd = new Date(m.getFullYear(), m.getMonth()+1, 0);
      buckets.push({label:(m.getMonth()+1)+"月", startStr:dateStr(m), endStr:dateStr(mEnd)<range.endStr?dateStr(mEnd):range.endStr});
    }
  } else {
    var start = new Date(range.startStr+"T00:00:00");
    var cursor = new Date(start);
    var weekNo = 1;
    while(dateStr(cursor)<=range.endStr){
      var wEnd = new Date(cursor); wEnd.setDate(wEnd.getDate()+6);
      var wEndStr = dateStr(wEnd)<range.endStr ? dateStr(wEnd) : range.endStr;
      buckets.push({label:"第"+weekNo+"週", startStr:dateStr(cursor), endStr:wEndStr});
      cursor.setDate(cursor.getDate()+7);
      weekNo++;
    }
  }
  return buckets;
}

function reportProjectBarsHtml(doneInRange){
  var counts = {};
  doneInRange.forEach(function(t){
    var key = t.projectId || "__none__";
    counts[key] = (counts[key]||0) + 1;
  });
  var rows = Object.keys(counts).map(function(key){
    var p = key==="__none__" ? null : projectById(key);
    return {name:p?p.name:"未分類", color:p?p.color:"#8C93A6", count:counts[key]};
  }).sort(function(a,b){ return b.count-a.count; });
  if(!rows.length) return '<div class="empty-slot small">這段期間還沒有完成任何任務</div>';
  var max = Math.max.apply(null, rows.map(function(r){ return r.count; }));
  return rows.map(function(r){
    var pct = Math.round(r.count/max*100);
    return (
      '<div class="bar-row">'+
        '<span class="dot" style="background:'+r.color+'"></span>'+
        '<span class="bar-label">'+escapeHtml(r.name)+'</span>'+
        '<span class="bar-track"><span class="bar-fill" style="width:'+pct+'%;background:'+r.color+'"></span></span>'+
        '<span class="bar-count mono">'+r.count+'</span>'+
      '</div>'
    );
  }).join("");
}

var PRIORITY_COLOR = {high:"var(--danger)", normal:"var(--accent)", low:"var(--status-todo)"};
var PRIORITY_LABEL = {high:"高", normal:"一般", low:"低"};
function reportPriorityHtml(doneInRange){
  var counts = {high:0, normal:0, low:0};
  doneInRange.forEach(function(t){ counts[t.priority]=(counts[t.priority]||0)+1; });
  var total = doneInRange.length;
  var bar = "", legend = "";
  ["high","normal","low"].forEach(function(k){
    if(!total || !counts[k]) return;
    var pct = (counts[k]/total*100).toFixed(2);
    bar += '<span class="priority-seg" style="width:'+pct+'%;background:'+PRIORITY_COLOR[k]+'"></span>';
    legend += '<span><span class="dot" style="background:'+PRIORITY_COLOR[k]+'"></span>'+PRIORITY_LABEL[k]+' '+counts[k]+'</span>';
  });
  $("reportPriorityBar").innerHTML = total ? bar : "";
  $("reportPriorityLegend").innerHTML = total ? legend : '<span>這段期間還沒有完成任何任務</span>';
}

function reportTrendHtml(buckets, doneInRange){
  var counts = buckets.map(function(b){
    return doneInRange.filter(function(t){ return inRange(localDateStr(t.completedAt), b); }).length;
  });
  var max = Math.max.apply(null, counts.concat([1]));
  return buckets.map(function(b,i){
    var pct = Math.round(counts[i]/max*100);
    return (
      '<div class="trend-bar">'+
        '<span class="trend-value">'+counts[i]+'</span>'+
        '<span class="trend-track"><span class="trend-fill" style="height:'+pct+'%"></span></span>'+
        '<span class="trend-label">'+b.label+'</span>'+
      '</div>'
    );
  }).join("");
}

function renderReportSheet(){
  setSeg("report-range-seg", reportMode);
  var range = reportRange(reportMode);
  $("reportRangeLabel").textContent = range.startStr.replace(/-/g,"/") + " ～ " + range.endStr.replace(/-/g,"/");

  var doneInRange = tasks.filter(function(t){ return t.completedAt && inRange(localDateStr(t.completedAt), range); });
  var addedInRange = tasks.filter(function(t){ return inRange(localDateStr(t.createdAt), range); });
  var urgentDone = doneInRange.filter(function(t){ return t.priority==="high"; });

  $("reportDoneCount").textContent = doneInRange.length;
  $("reportAddedCount").textContent = addedInRange.length;
  $("reportUrgentCount").textContent = urgentDone.length;

  $("reportProjectBars").innerHTML = reportProjectBarsHtml(doneInRange);
  reportPriorityHtml(doneInRange);

  $("reportTrendTitle").textContent = reportMode==="halfyear" ? "每月完成數" : "每週完成數";
  var buckets = reportBuckets(reportMode, range);
  $("reportTrend").innerHTML = reportTrendHtml(buckets, doneInRange);
}

function openReportSheet(){
  renderReportSheet();
  $("reportOverlay").hidden = false;
}
function closeReportSheet(){ $("reportOverlay").hidden = true; }

function renderStats(){
  var t = todayStr();
  var open = tasks.filter(function(x){ return x.status!=="done"; });
  var dueToday = open.filter(function(x){ return x.dueDate===t; }).length;
  var overdue = open.filter(function(x){ return x.dueDate && x.dueDate<t; }).length;
  var doing = tasks.filter(function(x){ return x.status==="doing"; }).length;
  $("statToday").querySelector(".n").textContent = dueToday;
  $("statOverdue").querySelector(".n").textContent = overdue;
  $("statDoing").querySelector(".n").textContent = doing;
  $("statOpen").querySelector(".n").textContent = open.length;

  $("statsRow").querySelectorAll("[data-stat]").forEach(function(btn){
    btn.setAttribute("data-active", btn.getAttribute("data-stat")===activeStatFilter ? "1" : "0");
  });
}

function renderChips(){
  var row = $("chipRow");
  var html = "";
  html += '<button class="chip" data-filter="__all__" data-active="'+(activeFilter?0:1)+'">全部<span class="count">'+tasks.filter(function(t){return t.status!=="done";}).length+'</span></button>';
  visibleProjects().forEach(function(p){
    var cnt = tasks.filter(function(t){ return t.projectId===p.id && t.status!=="done"; }).length;
    html += '<button class="chip" data-filter="'+p.id+'" data-active="'+(activeFilter===p.id?1:0)+'"><span class="dot" style="background:'+p.color+'"></span>'+escapeHtml(p.name)+'<span class="count">'+cnt+'</span></button>';
  });
  html += '<button class="chip ghost" id="manageProjBtn">⚙ 管理專案</button>';
  row.innerHTML = html;
  row.querySelectorAll("[data-filter]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var f = btn.getAttribute("data-filter");
      if(f==="__all__"){ activeFilter = null; }
      else{ activeFilter = (activeFilter===f) ? null : f; }
      render();
    });
  });
  $("manageProjBtn").addEventListener("click", openProjectModal);
}

function bellSvg(cls){
  return '<svg class="'+(cls||"")+'" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a1 1 0 0 1 1 1v1.06A7.002 7.002 0 0 1 19 11v3.586l1.707 1.707A1 1 0 0 1 20 18H4a1 1 0 0 1-.707-1.707L5 14.586V11a7.002 7.002 0 0 1 6-6.94V3a1 1 0 0 1 1-1zm0 20a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22z" fill="currentColor"/></svg>';
}
function linkSvg(){
  return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.41l3.53-3.53a2.5 2.5 0 1 1 3.54 3.54l-1.77 1.76a1 1 0 1 1-1.41-1.41l1.76-1.77a.5.5 0 0 0-.71-.7l-3.53 3.52a1 1 0 0 1-1.41 0zm-6.13 2.13a2.5 2.5 0 0 1 0-3.54l1.77-1.76a1 1 0 0 1 1.41 1.41l-1.76 1.77a.5.5 0 0 0 .71.7l3.53-3.52a1 1 0 0 1 1.41 1.41l-3.53 3.53a2.5 2.5 0 0 1-3.54 0z" fill="currentColor"/></svg>';
}

function cardHtml(t){
  var p = projectById(t.projectId);
  var color = p ? p.color : "#8C93A6";
  var name = p ? p.name : "未分類";
  var t0 = todayStr();
  var dueCls = "", dueLabel = "";
  if(t.dueDate){
    dueLabel = t.dueDate.slice(5).replace("-","/");
    if(t.status!=="done" && t.dueDate<t0) dueCls = "overdue";
    else if(t.dueDate===t0) dueCls = "today";
  }
  var idx = STATUSES.indexOf(t.status);
  var canLeft = idx>0, canRight = idx<STATUSES.length-1;
  return (
    '<div class="card" data-id="'+t.id+'">'+
      '<div class="card-top"><span class="dot" style="background:'+color+'"></span><span class="proj">'+escapeHtml(name)+'</span>'+
      (t.priority==="high" ? '<span class="urgent">急</span>' : '')+
      '</div>'+
      '<button type="button" class="card-title" data-open="'+t.id+'">'+escapeHtml(t.title)+'</button>'+
      '<div class="card-bottom">'+
        '<div class="card-meta">'+
          '<span class="due '+dueCls+'">'+(t.dueDate ? bellSvg() + dueLabel : "")+'</span>'+
          (t.link ? '<a class="task-link" href="'+escapeHtml(t.link)+'" target="_blank" rel="noopener noreferrer" aria-label="開啟檔案連結">'+linkSvg()+'</a>' : "")+
        '</div>'+
        '<div class="movebtns">'+
          '<button type="button" data-move="'+t.id+':-1" '+(canLeft?"":"disabled")+' aria-label="移到前一欄">‹</button>'+
          '<button type="button" data-move="'+t.id+':1" '+(canRight?"":"disabled")+' aria-label="移到下一欄">›</button>'+
        '</div>'+
      '</div>'+
    '</div>'
  );
}

function renderBoard(){
  var list = filteredTasks();
  STATUSES.forEach(function(st){
    var items = sortTasks(list.filter(function(t){ return t.status===st; }));
    var cap = st.charAt(0).toUpperCase()+st.slice(1);
    var container = $("list"+cap);
    var emptyMsg = (activeFilter || activeStatFilter) ? "沒有符合篩選條件的任務" : "這裡還沒有任務";
    container.innerHTML = items.length ? items.map(cardHtml).join("") : '<div class="empty-slot">'+emptyMsg+'</div>';
    $("count"+cap).textContent = items.length;
    $("tabCount"+cap).textContent = items.length;
  });
  $("board").querySelectorAll("[data-open]").forEach(function(btn){
    btn.addEventListener("click", function(){ openTaskSheet(btn.getAttribute("data-open")); });
  });
  $("board").querySelectorAll("[data-move]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var parts = btn.getAttribute("data-move").split(":");
      moveTask(parts[0], parseInt(parts[1],10));
    });
  });
}

function moveTask(id, delta){
  var t = tasks.find(function(x){ return x.id===id; });
  if(!t) return;
  var idx = STATUSES.indexOf(t.status) + delta;
  if(idx<0 || idx>=STATUSES.length) return;
  store.updateTask(id, {status:STATUSES[idx]});
}

/* ---------- task sheet ---------- */
function fillProjectSelect(currentId){
  var sel = $("task-project");
  var list = visibleProjects();
  var current = currentId ? projectById(currentId) : null;
  if(current && list.indexOf(current)===-1) list = [current].concat(list);
  var html = '<option value="">未分類</option>';
  html += list.map(function(p){
    var label = escapeHtml(p.name) + (p.archived ? "（已封存）" : "");
    return '<option value="'+p.id+'">'+label+'</option>';
  }).join("");
  sel.innerHTML = html;
}
function setSeg(segId, val){
  var seg = $(segId);
  seg.querySelectorAll("button").forEach(function(b){ b.setAttribute("data-on", b.getAttribute("data-val")===val?"1":"0"); });
}

var taskFormTouched = false;

function fillTaskForm(id, t){
  fillProjectSelect(t ? t.projectId : null);
  var overlay = $("taskOverlay");
  if(id && t){
    editingTaskId = id;
    $("taskSheetTitle").textContent = "編輯任務";
    $("task-title").value = t.title||"";
    $("task-project").value = t.projectId||"";
    $("task-due").value = t.dueDate||"";
    $("task-notes").value = t.notes||"";
    $("task-link").value = t.link||"";
    taskStatusValue = t.status||"todo";
    taskPriorityValue = t.priority||"normal";
    $("taskDelete").hidden = false;
  } else {
    editingTaskId = null;
    $("taskSheetTitle").textContent = "新增任務";
    $("task-title").value = "";
    $("task-project").value = activeFilter || (visibleProjects()[0] ? visibleProjects()[0].id : "");
    $("task-due").value = "";
    $("task-notes").value = "";
    $("task-link").value = "";
    taskStatusValue = editingStatusPreset;
    taskPriorityValue = "normal";
    $("taskDelete").hidden = true;
  }
  setSeg("task-status-seg", taskStatusValue);
  setSeg("task-priority-seg", taskPriorityValue);
  taskFormTouched = false;
  overlay.hidden = false;
  setTimeout(function(){ $("task-title").focus(); }, 0);
}

function openTaskSheet(id){
  if(!id){ fillTaskForm(null, null); return; }
  var cached = tasks.find(function(x){ return x.id===id; });
  if(!cached) return;
  // 先用手上的資料立刻開啟（不用等網路），同時跟伺服器要最新版本——
  // 這份任務可能是很久以前載入的，這段時間可能已經在別的裝置被改過（例如截止日期），
  // 不然編輯完儲存時會把舊欄位一起蓋回去，變成「改過的日期又跳回去」。
  fillTaskForm(id, cached);
  api.getTask(id).then(function(fresh){
    // 使用者若已經關掉、換編輯別的任務，或已經開始手動改欄位，就不要把資料蓋掉
    if(editingTaskId!==id || taskFormTouched) return;
    var idx = tasks.findIndex(function(x){ return x.id===id; });
    if(idx>-1) tasks[idx] = fresh;
    fillTaskForm(id, fresh);
  }).catch(function(){ /* 拿不到最新版就沿用本機資料，不擋住操作 */ });
}
function closeTaskSheet(){ $("taskOverlay").hidden = true; }

function scrollToColumn(status){
  var idx = STATUSES.indexOf(status);
  if(idx<0) return;
  var col = $("board").children[idx];
  if(!col) return;
  var behavior = reduceMotion() ? "auto" : "smooth";
  col.scrollIntoView({behavior:behavior, inline:"start", block:"nearest"});
}

function bindStaticHandlers(){
  $("board").addEventListener("click", function(e){
    var addBtn = e.target.closest("[data-add]");
    if(addBtn){ editingStatusPreset = addBtn.getAttribute("data-add"); openTaskSheet(null); }
  });
  $("mobileTabs").querySelectorAll("button").forEach(function(btn, i){
    btn.addEventListener("click", function(){ scrollToColumn(STATUSES[i]); });
  });
  $("statsRow").addEventListener("click", function(e){
    var btn = e.target.closest("[data-stat]");
    if(!btn) return;
    var key = btn.getAttribute("data-stat");
    activeStatFilter = (activeStatFilter===key) ? null : key;
    render();
    if(activeStatFilter==="doing") scrollToColumn("doing");
  });
  var boardEl = $("board");
  var tabBtns = $("mobileTabs").querySelectorAll("button");
  var scrollTick = false;
  boardEl.addEventListener("scroll", function(){
    if(scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(function(){
      var idx = Math.round(boardEl.scrollLeft / Math.max(boardEl.clientWidth,1));
      idx = Math.max(0, Math.min(STATUSES.length-1, idx));
      tabBtns.forEach(function(b,i){ b.setAttribute("data-current", i===idx?"1":"0"); });
      scrollTick = false;
    });
  });
  tabBtns[0].setAttribute("data-current","1");

  $("task-status-seg").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    taskStatusValue = b.getAttribute("data-val");
    setSeg("task-status-seg", taskStatusValue);
    taskFormTouched = true;
  });
  $("task-priority-seg").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    taskPriorityValue = b.getAttribute("data-val");
    setSeg("task-priority-seg", taskPriorityValue);
    taskFormTouched = true;
  });
  $("taskForm").addEventListener("input", function(){ taskFormTouched = true; });
  $("taskForm").addEventListener("change", function(){ taskFormTouched = true; });
  $("taskClose").addEventListener("click", closeTaskSheet);
  $("taskCancel").addEventListener("click", closeTaskSheet);
  $("taskOverlay").addEventListener("click", function(e){ if(e.target===$("taskOverlay")) closeTaskSheet(); });
  $("taskDelete").addEventListener("click", function(){
    if(!editingTaskId) return;
    if(!confirm("確定要刪除這個任務嗎？")) return;
    store.deleteTask(editingTaskId);
    closeTaskSheet();
  });
  $("taskForm").addEventListener("submit", function(e){
    e.preventDefault();
    var title = $("task-title").value.trim();
    if(!title) return;
    var data = {
      title: title,
      projectId: $("task-project").value || null,
      status: taskStatusValue,
      dueDate: $("task-due").value || null,
      priority: taskPriorityValue,
      notes: $("task-notes").value.trim(),
      link: $("task-link").value.trim() || null
    };
    if(editingTaskId){
      store.updateTask(editingTaskId, data);
    } else {
      store.addTask(data);
    }
    closeTaskSheet();
  });

  $("todayBtn").addEventListener("click", openTodaySheet);
  $("pushToggleBtn").addEventListener("click", togglePush);
  $("pushTestBtn").addEventListener("click", sendTestPush);
  $("todayClose").addEventListener("click", closeTodaySheet);
  $("todayOverlay").addEventListener("click", function(e){ if(e.target===$("todayOverlay")) closeTodaySheet(); });
  $("todaySearch").addEventListener("input", renderTodaySheet);

  $("reportBtn").addEventListener("click", openReportSheet);
  $("reportClose").addEventListener("click", closeReportSheet);
  $("reportOverlay").addEventListener("click", function(e){ if(e.target===$("reportOverlay")) closeReportSheet(); });
  $("report-range-seg").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    reportMode = b.getAttribute("data-val");
    renderReportSheet();
  });

  $("projClose").addEventListener("click", closeProjectModal);
  $("projOverlay").addEventListener("click", function(e){ if(e.target===$("projOverlay")) closeProjectModal(); });
  $("newProjAdd").addEventListener("click", function(){
    var name = $("newProjName").value.trim();
    if(!name) return;
    var color = newProjColor || PALETTE[0];
    store.addProject({name:name, color:color, archived:false}).then(function(){
      if(projects.some(function(p){ return p.name===name; })) $("newProjName").value = "";
      renderProjectModal();
    });
  });
}

/* ---------- project modal ---------- */
function openProjectModal(){
  renderProjectModal();
  renderNewProjSwatches();
  $("projOverlay").hidden = false;
}
function closeProjectModal(){ $("projOverlay").hidden = true; }
function swatchKeydown(e){
  if(e.key==="Enter" || e.key===" "){ e.preventDefault(); e.currentTarget.click(); }
}
function renderNewProjSwatches(){
  var wrap = $("newProjSwatches");
  wrap.innerHTML = PALETTE.map(function(c){
    return '<span class="swatch" role="button" tabindex="0" data-color="'+c+'" data-on="'+(c===newProjColor?1:0)+'" style="background:'+c+'" aria-label="選擇顏色"></span>';
  }).join("");
  wrap.querySelectorAll(".swatch").forEach(function(sw){
    sw.addEventListener("click", function(){
      newProjColor = sw.getAttribute("data-color");
      renderNewProjSwatches();
    });
    sw.addEventListener("keydown", swatchKeydown);
  });
}
function renderProjectModal(){
  var wrap = $("projList");
  wrap.innerHTML = projects.map(function(p){
    var swatches = PALETTE.map(function(c){
      return '<span class="swatch" role="button" tabindex="0" data-pid="'+p.id+'" data-color="'+c+'" data-on="'+(c===p.color?1:0)+'" style="background:'+c+'" aria-label="選擇顏色"></span>';
    }).join("");
    return (
      '<div class="proj-row" data-archived="'+(p.archived?1:0)+'">'+
        '<input type="text" value="'+escapeHtml(p.name)+'" data-rename="'+p.id+'" aria-label="專案名稱">'+
        '<div class="swatches">'+swatches+'</div>'+
        '<button type="button" class="mini-btn" data-archive="'+p.id+'">'+(p.archived?"取消封存":"封存")+'</button>'+
        '<button type="button" class="mini-btn" data-delproj="'+p.id+'" style="color:var(--danger);">刪除</button>'+
      '</div>'
    );
  }).join("") || '<p style="color:var(--text-muted);font-size:13px;">還沒有專案</p>';

  wrap.querySelectorAll("[data-rename]").forEach(function(inp){
    inp.addEventListener("change", function(){
      var v = inp.value.trim();
      if(v) store.updateProject(inp.getAttribute("data-rename"), {name:v});
    });
  });
  wrap.querySelectorAll(".swatch[data-pid]").forEach(function(sw){
    sw.addEventListener("click", function(){
      store.updateProject(sw.getAttribute("data-pid"), {color:sw.getAttribute("data-color")}).then(renderProjectModal);
    });
    sw.addEventListener("keydown", swatchKeydown);
  });
  wrap.querySelectorAll("[data-archive]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var id = btn.getAttribute("data-archive");
      var p = projectById(id);
      store.updateProject(id, {archived: !(p && p.archived)}).then(renderProjectModal);
    });
  });
  wrap.querySelectorAll("[data-delproj]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var id = btn.getAttribute("data-delproj");
      var count = tasks.filter(function(t){ return t.projectId===id; }).length;
      if(!confirm("刪除專案會一併刪除底下 "+count+" 個任務，確定要刪除嗎？")) return;
      if(activeFilter===id) activeFilter = null;
      store.deleteProject(id).then(renderProjectModal);
    });
  });
}

boot();
