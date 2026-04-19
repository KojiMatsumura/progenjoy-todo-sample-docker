(function () {
  "use strict";

  var B = window.TodoBridge;
  if (!B) {
    console.error("todo-bridge.js を先に読み込んでください");
    return;
  }

  var items = [];
  /** data.json の content 全体（他キー保持のため） */
  var lastContent = {};

  var elList = document.getElementById("todo-list");
  var elInput = document.getElementById("new-title");
  var elStatus = document.getElementById("status");
  var btnAdd = document.getElementById("btn-add");
  var btnReload = document.getElementById("btn-reload");

  function setStatus(msg, isError) {
    elStatus.textContent = msg || "";
    elStatus.className = "status" + (isError ? " error" : "");
  }

  /**
   * ストレージから読んだ配列を正規化（欠けた id / createdAt を補い、マイグレーションが必要ならフラグ）
   */
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

  /**
   * @returns {Promise<"migration"|"ok">}
   */
  function applyPayload(data) {
    var root =
      data && typeof data.content === "object" && data.content !== null
        ? data.content
        : {};
    lastContent = root;
    var norm = normalizeItemsFromRoot(root);
    items = norm.items;
    render();
    if (norm.migrationNeeded && B.hasParent()) {
      setStatus("データを補正して保存しています…");
      var content = buildContentForSave();
      return B.requestSave(content)
        .then(function (d2) {
          var root2 =
            d2 && typeof d2.content === "object" && d2.content !== null
              ? d2.content
              : {};
          lastContent = root2;
          var norm2 = normalizeItemsFromRoot(root2);
          items = norm2.items;
          render();
          setStatus("読込完了（データを更新しました）");
          return "migration";
        })
        .catch(function (e) {
          setStatus(e.message || String(e), true);
          return Promise.reject(e);
        });
    }
    return Promise.resolve("ok");
  }

  function buildContentForSave() {
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

  function save() {
    if (!B.hasParent()) {
      setStatus("保存できません（親なし）", true);
      return;
    }
    setStatus("保存中…");
    var content = buildContentForSave();
    B.requestSave(content)
      .then(function (data) {
        var root =
          data && typeof data.content === "object" && data.content !== null
            ? data.content
            : {};
        lastContent = root;
        var norm = normalizeItemsFromRoot(root);
        items = norm.items;
        render();
        setStatus("保存しました");
      })
      .catch(function (e) {
        setStatus(e.message || String(e), true);
      });
  }

  function load() {
    if (!B.hasParent()) {
      setStatus("読込にはランナー（/）の iframe 内で開いてください", true);
      render();
      return;
    }
    setStatus("読込中…");
    B.requestRead()
      .then(function (data) {
        return applyPayload(data);
      })
      .then(function (tag) {
        if (tag === "migration") return;
        setStatus("読込完了（api_id:1）");
      })
      .catch(function (e) {
        setStatus(e.message || String(e), true);
        render();
      });
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
      });
    } catch (e) {
      return iso;
    }
  }

  function render() {
    elList.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "TODO はまだありません。追加するか、読込してください。";
      elList.appendChild(empty);
      return;
    }

    var ul = document.createElement("ul");
    ul.className = "todos";

    items.forEach(function (it) {
      var li = document.createElement("li");
      if (it.done) li.className = "done";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!it.done;
      cb.setAttribute("data-id", it.id);
      cb.className = "todo-cb";
      cb.addEventListener("click", function (e) {
        e.stopPropagation();
      });

      var main = document.createElement("div");
      main.className = "todo-main";

      var link = document.createElement("a");
      link.className = "todo-detail-link-block";
      link.href = "detail.html?id=" + encodeURIComponent(it.id);

      var titleEl = document.createElement("span");
      titleEl.className = "todo-title-text";
      titleEl.textContent = it.title || "（無題）";

      var meta = document.createElement("div");
      meta.className = "todo-meta";
      meta.textContent =
        "作成: " + formatDate(it.createdAt) + " ・ ID: " + it.id.slice(0, 8) + "…";

      link.appendChild(titleEl);
      link.appendChild(meta);
      main.appendChild(link);

      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-danger";
      btnDel.textContent = "削除";
      btnDel.setAttribute("data-id", it.id);

      li.appendChild(cb);
      li.appendChild(main);
      li.appendChild(btnDel);
      ul.appendChild(li);
    });

    elList.appendChild(ul);

    ul.querySelectorAll("input.todo-cb").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var id = cb.getAttribute("data-id");
        items = items.map(function (x) {
          if (x.id !== id) return x;
          return {
            id: x.id,
            title: x.title,
            done: cb.checked,
            createdAt: x.createdAt,
          };
        });
        save();
      });
    });

    ul.querySelectorAll("button.btn-danger").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute("data-id");
        items = items.filter(function (x) {
          return x.id !== id;
        });
        save();
      });
    });
  }

  btnAdd.addEventListener("click", function () {
    var title = (elInput.value || "").trim();
    if (!title) {
      setStatus("タイトルを入力してください", true);
      return;
    }
    items.push({
      id: B.genId(),
      title: title,
      done: false,
      createdAt: new Date().toISOString(),
    });
    elInput.value = "";
    save();
  });

  btnReload.addEventListener("click", function () {
    load();
  });

  elInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") btnAdd.click();
  });

  render();
  load();
})();
