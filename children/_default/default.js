(function () {
  var logEl = document.getElementById("log");
  function log(line) {
    logEl.textContent =
      new Date().toISOString().slice(11, 19) + " " + line + "\n" + logEl.textContent;
  }

  window.addEventListener("message", function (ev) {
    log("受信: " + JSON.stringify(ev.data));
  });

  document.getElementById("btn-ping").onclick = function () {
    if (!window.parent || window.parent === window) {
      log("親フレームなし（単体表示）");
      return;
    }
    window.parent.postMessage({ api_id: 1, content: null }, "*");
    log("送信: api_id 1");
  };

  document.getElementById("btn-save").onclick = function () {
    if (!window.parent || window.parent === window) {
      log("親フレームなし（単体表示）");
      return;
    }
    window.parent.postMessage(
      {
        api_id: 2,
        content: { savedAt: new Date().toISOString(), source: "children/_default" },
      },
      "*"
    );
    log("送信: api_id 2");
  };

  document.getElementById("btn-sub").onclick = function () {
    if (!window.parent || window.parent === window) {
      window.location.href = "./subpage.html";
      return;
    }
    window.parent.postMessage(
      {
        api_id: 3,
        redirect_url: "/subpage.html",
        content: { demo: true, from: "index" },
      },
      "*"
    );
    log("送信: api_id 3 redirect /subpage.html");
  };
})();
