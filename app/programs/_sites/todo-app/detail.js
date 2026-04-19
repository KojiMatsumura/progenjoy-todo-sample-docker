(function () {
  "use strict";

  var B = window.TodoBridge;
  if (!B) {
    console.error("todo-bridge.js を先に読み込んでください");
    return;
  }

  var elStatus = document.getElementById("status");
  var elRoot = document.getElementById("detail-root");
  var elNotFound = document.getElementById("detail-notfound");
  var elTitle = document.getElementById("detail-title");
  var elCreated = document.getElementById("detail-created");
  var elId = document.getElementById("detail-id");
  var elDone = document.getElementById("detail-done");
  var btnDelete = document.getElementById("btn-delete");

  var lastContent = {};
  var currentId = null;
  var currentItem = null;

  function setStatus(msg, isError) {
    elStatus.textContent = msg || "";
    elStatus.className = "status" + (isError ? " error" : "");
  }

  function getQueryId() {
    var q = new URLSearchParams(window.location.search).get("id");
    return q && q.length > 0 ? q : null;
  }

  function normalizeItemsFromRoot(root) {
    var ta = root && root.todoApp;
    var raw = [];
    if (ta && typeof ta === "object" && Array.isArray(ta.items)) {
      raw = ta.items;
    }
    var migrationNeeded = false;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i];
      if (!it || typeof it !== "object") continue;
      var id;
      if (typeof it.id === "string" && it.id.length > 0) {
        id = it.id;
      } else {
        migrationNeeded = true;
        id = B.genId();
      }
      var title = typeof it.title === "string" ? it.title : "";
      var createdAt;
      if (typeof it.createdAt === "string" && it.createdAt.length > 0) {
        createdAt = it.createdAt;
      } else {
        migrationNeeded = true;
        createdAt = new Date().toISOString();
      }
      out.push({
        id: id,
        title: title,
        done: !!it.done,
        createdAt: createdAt,
      });
    }
    return { items: out, migrationNeeded: migrationNeeded };
  }

  function buildContentForSave(items) {
    var next = {};
    var k;
    for (k in lastContent) {
      if (Object.prototype.hasOwnProperty.call(lastContent, k)) {
        next[k] = lastContent[k];
      }
    }
    next.todoApp = {
      items: items.map(function (it) {
        return {
          id: it.id,
          title: it.title,
          done: !!it.done,
          createdAt: it.createdAt,
        };
      }),
      updatedAt: new Date().toISOString(),
    };
    return next;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (e) {
      return iso;
    }
  }

  function showNotFound() {
    elRoot.hidden = true;
    elNotFound.hidden = false;
  }

  function showDetail(item) {
    elNotFound.hidden = true;
    elRoot.hidden = false;
    currentItem = item;
    elTitle.textContent = item.title || "（無題）";
    elCreated.textContent = formatDate(item.createdAt);
    elId.textContent = item.id;
    elDone.checked = !!item.done;
  }

  function applyData(data, id) {
    var root =
      data && typeof data.content === "object" && data.content !== null
        ? data.content
        : {};
    lastContent = root;
    var norm = normalizeItemsFromRoot(root);
    var items = norm.items;

    if (norm.migrationNeeded && B.hasParent()) {
      return B.requestSave(buildContentForSave(items)).then(function (d2) {
        return applyData(d2, id);
      });
    }

    var found = items.filter(function (x) {
      return x.id === id;
    })[0];
    if (!found) {
      showNotFound();
      setStatus("");
      return;
    }
    showDetail(found);
    setStatus("");
  }

  function load() {
    currentId = getQueryId();
    if (!currentId) {
      setStatus("id パラメータがありません", true);
      showNotFound();
      return;
    }
    if (!B.hasParent()) {
      setStatus("読込にはランナー（/）の iframe 内で開いてください", true);
      showNotFound();
      return;
    }
    setStatus("読込中…");
    B.requestRead()
      .then(function (data) {
        applyData(data, currentId);
      })
      .catch(function (e) {
        setStatus(e.message || String(e), true);
        showNotFound();
      });
  }

  function getAllItemsFromLast() {
    var norm = normalizeItemsFromRoot(lastContent);
    return norm.items;
  }

  function saveItems(items) {
    if (!B.hasParent()) return;
    setStatus("保存中…");
    B.requestSave(buildContentForSave(items))
      .then(function (data) {
        var root =
          data && typeof data.content === "object" && data.content !== null
            ? data.content
            : {};
        lastContent = root;
        setStatus("保存しました");
      })
      .catch(function (e) {
        setStatus(e.message || String(e), true);
      });
  }

  elDone.addEventListener("change", function () {
    if (!currentId || !currentItem) return;
    var items = getAllItemsFromLast().map(function (x) {
      if (x.id !== currentId) return x;
      return {
        id: x.id,
        title: x.title,
        done: elDone.checked,
        createdAt: x.createdAt,
      };
    });
    currentItem.done = elDone.checked;
    saveItems(items);
  });

  btnDelete.addEventListener("click", function () {
    if (!currentId) return;
    if (!window.confirm("この TODO を削除しますか？")) return;
    var items = getAllItemsFromLast().filter(function (x) {
      return x.id !== currentId;
    });
    if (!B.hasParent()) return;
    setStatus("保存中…");
    B.requestSave(buildContentForSave(items))
      .then(function () {
        window.location.href = "index.html";
      })
      .catch(function (e) {
        setStatus(e.message || String(e), true);
      });
  });

  load();
})();
