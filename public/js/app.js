import { api } from "./api.js";

var PALETTE = ["#DE5D83","#3E7FC4","#3F9A5D","#E0A23E","#8B7CC0","#3EA8A0","#C1432E","#8C93A6"];
var STATUSES = ["todo","doing","done"];
var PRIORITY_RANK = {high:0, normal:1, low:2};

var projects = [];
var tasks = [];
var activeFilter = null;
var editingTaskId = null;
var editingStatusPreset = "todo";
var taskStatusValue = "todo";
var taskPriorityValue = "normal";
var newProjColor = PALETTE[0];

var $ = function(id){ return document.getElementById(id); };

function todayStr(){
  var d = new Date();
  var y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
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

var store = {
  addProject: function(data){ return api.addProject(data).then(loadAll); },
  updateProject: function(id, patch){ return api.updateProject(id, patch).then(loadAll); },
  deleteProject: function(id){ return api.deleteProject(id).then(loadAll); },
  addTask: function(data){ return api.addTask(data).then(loadAll); },
  updateTask: function(id, patch){ return api.updateTask(id, patch).then(loadAll); },
  deleteTask: function(id){ return api.deleteTask(id).then(loadAll); }
};

/* ---------- boot ---------- */
function boot(){
  $("todayLabel").textContent = fmtToday();
  bindStaticHandlers();
  render();
  loadAll().catch(function(){ toast("無法連線到伺服器，請檢查網路後重新整理"); });
}

/* ---------- derived data ---------- */
function visibleProjects(){
  return projects.filter(function(p){ return !p.archived; });
}
function projectById(id){
  for(var i=0;i<projects.length;i++){ if(projects[i].id===id) return projects[i]; }
  return null;
}
function filteredTasks(){
  if(!activeFilter) return tasks;
  return tasks.filter(function(t){ return t.projectId===activeFilter; });
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
}

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
        '<span class="due '+dueCls+'">'+(t.dueDate ? bellSvg() + dueLabel : "")+'</span>'+
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
    container.innerHTML = items.length ? items.map(cardHtml).join("") : '<div class="empty-slot">這裡還沒有任務</div>';
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
function fillProjectSelect(){
  var sel = $("task-project");
  sel.innerHTML = visibleProjects().map(function(p){ return '<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>'; }).join("");
}
function setSeg(segId, val){
  var seg = $(segId);
  seg.querySelectorAll("button").forEach(function(b){ b.setAttribute("data-on", b.getAttribute("data-val")===val?"1":"0"); });
}

function openTaskSheet(id){
  fillProjectSelect();
  var overlay = $("taskOverlay");
  if(id){
    var t = tasks.find(function(x){ return x.id===id; });
    if(!t) return;
    editingTaskId = id;
    $("taskSheetTitle").textContent = "編輯任務";
    $("task-title").value = t.title||"";
    $("task-project").value = t.projectId||"";
    $("task-due").value = t.dueDate||"";
    $("task-notes").value = t.notes||"";
    taskStatusValue = t.status||"todo";
    taskPriorityValue = t.priority||"normal";
    $("taskDelete").hidden = false;
  } else {
    editingTaskId = null;
    $("taskSheetTitle").textContent = "新增任務";
    $("task-title").value = "";
    if(visibleProjects().length) $("task-project").value = visibleProjects()[0].id;
    $("task-due").value = "";
    $("task-notes").value = "";
    taskStatusValue = editingStatusPreset;
    taskPriorityValue = "normal";
    $("taskDelete").hidden = true;
  }
  setSeg("task-status-seg", taskStatusValue);
  setSeg("task-priority-seg", taskPriorityValue);
  overlay.hidden = false;
  setTimeout(function(){ $("task-title").focus(); }, 0);
}
function closeTaskSheet(){ $("taskOverlay").hidden = true; }

function bindStaticHandlers(){
  $("board").addEventListener("click", function(e){
    var addBtn = e.target.closest("[data-add]");
    if(addBtn){ editingStatusPreset = addBtn.getAttribute("data-add"); openTaskSheet(null); }
  });
  $("mobileTabs").querySelectorAll("button").forEach(function(btn, i){
    btn.addEventListener("click", function(){
      var col = $("board").children[i];
      var behavior = reduceMotion() ? "auto" : "smooth";
      col.scrollIntoView({behavior:behavior, inline:"start", block:"nearest"});
    });
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
  });
  $("task-priority-seg").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    taskPriorityValue = b.getAttribute("data-val");
    setSeg("task-priority-seg", taskPriorityValue);
  });
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
      projectId: $("task-project").value || (visibleProjects()[0] && visibleProjects()[0].id) || "",
      status: taskStatusValue,
      dueDate: $("task-due").value || null,
      priority: taskPriorityValue,
      notes: $("task-notes").value.trim()
    };
    if(editingTaskId){
      store.updateTask(editingTaskId, data);
    } else {
      store.addTask(data);
    }
    closeTaskSheet();
  });

  $("projClose").addEventListener("click", closeProjectModal);
  $("projOverlay").addEventListener("click", function(e){ if(e.target===$("projOverlay")) closeProjectModal(); });
  $("newProjAdd").addEventListener("click", function(){
    var name = $("newProjName").value.trim();
    if(!name) return;
    var color = newProjColor || PALETTE[0];
    store.addProject({name:name, color:color, archived:false}).then(function(){
      $("newProjName").value = "";
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
function renderNewProjSwatches(){
  var wrap = $("newProjSwatches");
  wrap.innerHTML = PALETTE.map(function(c){
    return '<button type="button" class="swatch" data-color="'+c+'" data-on="'+(c===newProjColor?1:0)+'" style="background:'+c+'" aria-label="選擇顏色"></button>';
  }).join("");
  wrap.querySelectorAll(".swatch").forEach(function(sw){
    sw.addEventListener("click", function(){
      newProjColor = sw.getAttribute("data-color");
      renderNewProjSwatches();
    });
  });
}
function renderProjectModal(){
  var wrap = $("projList");
  wrap.innerHTML = projects.map(function(p){
    var swatches = PALETTE.map(function(c){
      return '<button type="button" class="swatch" data-pid="'+p.id+'" data-color="'+c+'" data-on="'+(c===p.color?1:0)+'" style="background:'+c+'" aria-label="選擇顏色"></button>';
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
      if(!confirm("刪除專案會一併刪除底下所有任務，確定要刪除嗎？")) return;
      var toDelete = tasks.filter(function(t){ return t.projectId===id; });
      Promise.all(toDelete.map(function(t){ return store.deleteTask(t.id); })).then(function(){
        return store.deleteProject(id);
      }).then(renderProjectModal);
    });
  });
}

boot();
