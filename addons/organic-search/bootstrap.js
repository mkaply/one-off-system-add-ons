/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/* We need to disable these because this system add-on
 * goes back to Firefox 43 */

/* eslint-disable mozilla/no-define-cc-etc */
/* eslint-disable mozilla/use-chromeutils-import */
/* eslint-disable mozilla/no-useless-parameters */
/* eslint-disable mozilla/use-chromeutils-generateqi */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

Cu.importGlobalProperties(["URLSearchParams"]);

// Regular expressions used to identify common search URLS.
const SEARCH_URL_REGEX = new RegExp([
  /^https:\/\/www\.(google)\.(?:.+)\/search/,
  /^https:\/\/(?:.*)search\.(yahoo)\.com\/search/,
  /^https:\/\/www\.(bing)\.com\/search/,
  /^https:\/\/(duckduckgo)\.com\//,
  /^https:\/\/www\.(baidu)\.com\/(?:s|baidu)/,
].map(regex => regex.source).join("|"));

// Used to identify various parameters (query, code, etc.) in search URLS.
const SEARCH_PROVIDER_INFO = {
  "google": {
    "queryParam": "q",
    "codeParam": "client",
    "codePrefixes": ["firefox"],
    "followonParams": ["oq", "ved", "ei"],
  },
  "duckduckgo": {
    "queryParam": "q",
    "codeParam": "t",
    "codePrefixes": ["ff"],
  },
  "yahoo": {
    "queryParam": "p",
  },
  "baidu": {
    "queryParam": "wd",
    "codeParam": "tn",
    "codePrefixes": ["monline_dg"],
    "followonParams": ["oq"],
  },
  "bing": {
    "queryParam": "q",
    "codeParam": "pc",
    "codePrefixes": ["MOZ", "MZ"],
  },
};

const SEARCH_COUNTS_HISTOGRAM_KEY = "SEARCH_COUNTS";

// Observed topic names.
const TAB_RESTORING_TOPIC = "SSTabRestoring";
const DOMWINDOW_OPENED_TOPIC = "domwindowopened";

// For 62.0.1 and above, we don't record Google searches
let noGoogle = false;

let URICountListener = {
  // A set containing the visited domains, see bug 1271310.
  _domainSet: new Set(),
  // A map to keep track of the URIs loaded from the restored tabs.
  _restoredURIsMap: new WeakMap(),

  isHttpURI(uri) {
    // Only consider http(s) schemas.
    return uri.schemeIs("http") || uri.schemeIs("https");
  },

  addRestoredURI(browser, uri) {
    if (!this.isHttpURI(uri)) {
      return;
    }

    this._restoredURIsMap.set(browser, uri.spec);
  },

  onLocationChange(browser, webProgress, request, uri, flags) {
    // Don't count this URI if it's an error page.
    if (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_ERROR_PAGE) {
      return;
    }

    // We only care about top level loads.
    if (!webProgress.isTopLevel) {
      return;
    }

    // The SessionStore sets the URI of a tab first, firing onLocationChange the
    // first time, then manages content loading using its scheduler. Once content
    // loads, we will hit onLocationChange again.
    // We can catch the first case by checking for null requests: be advised that
    // this can also happen when navigating page fragments, so account for it.
    if (!request &&
        !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) {
      return;
    }

    // Track URI loads, even if they're not http(s).
    let uriSpec = null;
    try {
      uriSpec = uri.spec;
    } catch (e) {
      return;
    }

    // Don't count about:blank and similar pages, as they would artificially
    // inflate the counts.
    if (browser.ownerGlobal.gInitialPages.includes(uriSpec)) {
      return;
    }

    // If the URI we're loading is in the _restoredURIsMap, then it comes from a
    // restored tab. If so, let's skip it and remove it from the map as we want to
    // count page refreshes.
    if (this._restoredURIsMap.get(browser) === uriSpec) {
      this._restoredURIsMap.delete(browser);
      return;
    }

    if (!this.isHttpURI(uri)) {
      return;
    }

    this._recordSearchURLTelemetry(uriSpec);
  },

  _recordSearchURLTelemetry(url) {
    let matches = url.match(SEARCH_URL_REGEX);
    if (!matches) {
      return;
    }
    let provider = matches.filter((e, i) => e && i != 0)[0];
    if (provider == "google" && noGoogle) {
      return;
    }
    let searchProviderInfo = SEARCH_PROVIDER_INFO[provider];
    let queries = new URLSearchParams(url.split("#")[0].split("?")[1]);
    if (!queries.get(searchProviderInfo.queryParam)) {
      return;
    }
    // Default to organic to simplify things.
    // We override type in the sap cases.
    let type = "organic";
    let code;
    if (searchProviderInfo.codeParam) {
      code = queries.get(searchProviderInfo.codeParam);
      if (code &&
          searchProviderInfo.codePrefixes.some(p => code.startsWith(p))) {
        if (searchProviderInfo.followonParams &&
           searchProviderInfo.followonParams.some(p => queries.has(p))) {
          type = "sap-follow-on";
        } else {
          type = "sap";
        }
      } else if (provider == "bing") {
        // Bing requires lots of extra work related to cookies.
        let secondaryCode = queries.get("form");
        // This code is used for all Bing follow-on searches.
        if (secondaryCode == "QBRE") {
          for (let cookie of Services.cookies.getCookiesFromHost("www.bing.com", {})) {
            if (cookie.name == "SRCHS") {
              // If this cookie is present, it's probably an SAP follow-on.
              // This might be an organic follow-on in the same session,
              // but there is no way to tell the difference.
              if (searchProviderInfo.codePrefixes.some(p => cookie.value.startsWith("PC=" + p))) {
                type = "sap-follow-on";
                code = cookie.value.split("=")[1];
                break;
              }
            }
          }
        }
      }
    }

    let payload = `${provider}.in-content:${type}:${code || "none"}`;
    let histogram = Services.telemetry.getKeyedHistogramById(SEARCH_COUNTS_HISTOGRAM_KEY);
    histogram.add(payload);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                          Ci.nsISupportsWeakReference]),
};

let BrowserUsageTelemetry = {
  _inited: false,

  init() {
    this._setupAfterRestore();
    this._inited = true;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                          Ci.nsISupportsWeakReference]),

  uninit() {
    if (!this._inited) {
      return;
    }
    Services.obs.removeObserver(this, DOMWINDOW_OPENED_TOPIC);
  },

  observe(subject, topic, data) {
    switch (topic) {
      case DOMWINDOW_OPENED_TOPIC:
        this._onWindowOpen(subject);
        break;
    }
  },

  handleEvent(event) {
    switch (event.type) {
      case "unload":
        this._unregisterWindow(event.target);
        break;
      case TAB_RESTORING_TOPIC:
        // We're restoring a new tab from a previous or crashed session.
        // We don't want to track the URIs from these tabs, so let
        // |URICountListener| know about them.
        let browser = event.target.linkedBrowser;
        URICountListener.addRestoredURI(browser, browser.currentURI);
        break;
    }
  },

  /**
   * This gets called shortly after the SessionStore has finished restoring
   * windows and tabs. It counts the open tabs and adds listeners to all the
   * windows.
   */
  _setupAfterRestore() {
    // Make sure to catch new chrome windows and subsession splits.
    Services.obs.addObserver(this, DOMWINDOW_OPENED_TOPIC, true);

    // Attach the tabopen handlers to the existing Windows.
    let browserEnum = Services.wm.getEnumerator("navigator:browser");
    while (browserEnum.hasMoreElements()) {
      this._registerWindow(browserEnum.getNext());
    }
  },

  /**
   * Adds listeners to a single chrome window.
   */
  _registerWindow(win) {
    win.addEventListener("unload", this);

    win.gBrowser.tabContainer.addEventListener(TAB_RESTORING_TOPIC, this);
    win.gBrowser.addTabsProgressListener(URICountListener);
  },

  /**
   * Removes listeners from a single chrome window.
   */
  _unregisterWindow(win) {
    win.removeEventListener("unload", this);

    win.defaultView.gBrowser.tabContainer.removeEventListener(TAB_RESTORING_TOPIC, this);
    win.defaultView.gBrowser.removeTabsProgressListener(URICountListener);
  },

  /**
   * Tracks the window count and registers the listeners for the tab count.
   * @param{Object} win The window object.
   */
  _onWindowOpen(win) {
    // Make sure to have a |nsIDOMWindow|.
    if (!(win instanceof Ci.nsIDOMWindow)) {
      return;
    }

    let onLoad = () => {
      win.removeEventListener("load", onLoad);

      // Ignore non browser windows.
      if (win.document.documentElement.getAttribute("windowtype") != "navigator:browser") {
        return;
      }

      this._registerWindow(win);
    };
    win.addEventListener("load", onLoad);
  },
};

let observer = {
  observe: function observe(subject, topic, data) {
    switch (topic) {
      case "sessionstore-windows-restored":
        BrowserUsageTelemetry.init();
        break;
      case "quit-application-granted":
        BrowserUsageTelemetry.init();
        break;
    }
  },
};

function install(aData, aReason) {}

function uninstall(aData, aReason) {}

function startup(aData, aReason) {
  // We added Google organic search in 62.0.1
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1475571
  noGoogle = (Services.vc.compare("62.0.1", Services.appinfo.version) > 0);
  Services.obs.addObserver(observer, "sessionstore-windows-restored", false);
  Services.obs.addObserver(observer, "quit-application-granted", false);
}
function shutdown(aData, aReason) {
  Services.obs.removeObserver(observer, "sessionstore-windows-restored");
  Services.obs.removeObserver(observer, "quit-application-granted");
}
