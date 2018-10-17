const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

let observer = {
  _submissionURLIgnoreList: [
    "hspart=lvs",
    "form=CONBDF",
    "clid=2308146",
    "fr=mcafee",
    "PC=MC0",
  ],

  _loadPathIgnoreList: [
    "[https]opensearch.webofsearch.com/bing-search.xml",
    "[https]opensearch.startpageweb.com/bing-search.xml",
    "[https]opensearch.startwebsearch.com/bing-search.xml",
    "[https]opensearch.webstartsearch.com/bing-search.xml",
  ],

  observe: function observe(subject, topic, data) {
    switch (topic) {
      case "browser-search-service":
        if (data != "init-complete") {
          return;
        }
        let engines = Services.search.getEngines();
        engines.forEach(engine => {
          let url = engine.getSubmission("dummy", null, "keyword").uri.spec.toLowerCase();
          if (this._submissionURLIgnoreList.some(code => url.includes(code.toLowerCase()))) {
            Services.search.removeEngine(engine);
            return;
          }
          if (this._loadPathIgnoreList.includes(engine.wrappedJSObject._loadPath)) {
            Services.search.removeEngine(engine);
            return;
          }
        });
        break;
    }
  }
}

function install(aData, aReason) {}

function uninstall(aData, aReason) {}

function startup(aData, aReason) {
  Services.obs.addObserver(observer, "browser-search-service", false);
}
function shutdown(aData, aReason) {
  Services.obs.removeObserver(observer, "browser-search-service");
}
