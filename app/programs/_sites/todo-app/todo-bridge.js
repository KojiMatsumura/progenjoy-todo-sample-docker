(function (global) {
  "use strict";

  var pending = null;
  var apiChain = Promise.resolve();

  function enqueueApi(fn) {
    return new Promise(function (resolve, reject) {
      apiChain = apiChain
        .then(function () {
          return fn();
        })
        .then(resolve, reject);
    });
  }

  function hasParent() {
    return window.parent && window.parent !== window;
  }

  function genId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return String(Date.now()) + "-" + String(Math.random()).slice(2, 10);
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!pending) return;
    if (d && d.api_id === 3) return;

    if (d && d.error) {
      var fn = pending;
      pending = null;
      fn(new Error(d.message || "error"), null);
      return;
    }

    if (d && typeof d.content === "object" && d.content !== null) {
      var cb = pending;
      pending = null;
      cb(null, d);
    }
  });

  function requestRead() {
    return enqueueApi(function () {
      return new Promise(function (resolve, reject) {
        if (!hasParent()) {
          reject(new Error("親フレームなし（単体では data.json に接続できません）"));
          return;
        }
        pending = function (err, data) {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        };
        window.parent.postMessage({ api_id: 1, content: null }, "*");
      });
    });
  }

  function requestSave(contentObject) {
    return enqueueApi(function () {
      return new Promise(function (resolve, reject) {
        if (!hasParent()) {
          reject(new Error("親フレームなし"));
          return;
        }
        pending = function (err, data) {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        };
        window.parent.postMessage({ api_id: 2, content: contentObject }, "*");
      });
    });
  }

  global.TodoBridge = {
    enqueueApi: enqueueApi,
    hasParent: hasParent,
    genId: genId,
    requestRead: requestRead,
    requestSave: requestSave,
  };
})(window);
