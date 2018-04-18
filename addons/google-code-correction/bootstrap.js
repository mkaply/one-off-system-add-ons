/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/* eslint-disable-next-line */
let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

/* eslint-disable mozilla/use-chromeutils-import */
Cu.import("resource://gre/modules/Services.jsm");

function startup(data, reason) {
  if (Services.search.isInitialized) {
    overrideSearchEngine();
  } else {
    Services.obs.addObserver(function searchObserver(subject, topic, data) {
      if (data == "init-complete") {
        Services.obs.removeObserver(searchObserver, "browser-search-service");
        overrideSearchEngine();
      }
    }, "browser-search-service", false);
  }
}

function shutdown() {}
function install() {}
function uninstall() {}

function overrideSearchEngine() {
  let engine = Services.search.getEngineByName("Google");
  if (!engine) {
    return;
  }
  let countryCode;
  let searchCode;
  let shortName;
  try {
    countryCode = Services.prefs.getCharPref("browser.search.countryCode");
  } catch (e) {}
  if (countryCode == "US") {
    searchCode = "firefox-b-1";
    shortName = "google-2018-sysaddon";
  } else {
    // Err on the side of using global codes
    searchCode = "firefox-b";
    shortName = "google-sysaddon";
  }

  let testSubmission = engine.getSubmission("test", null, "searchbar");
  if (testSubmission.uri.spec.endsWith(searchCode)) {
    // We already have the correct search code. Don't do anything.
    return;
  }

  engine = engine.wrappedJSObject;
  let url = engine._urls.filter(u => u.type == "text/html")[0];
  let clientParams = url.params.filter(p => p.name == "client");
  let paramsWithPurpose = clientParams.filter(p => p.purpose);
  if (clientParams.length &&
      !paramsWithPurpose.length) {
    return;
  }
  if (paramsWithPurpose.length) {
    url.params = url.params.filter(p => !p.purpose);
  }
  url.params.push({name: "client", value: searchCode, purpose: "searchbar"});
  url.params.push({name: "client", value: searchCode + "-ab", purpose: "keyword"});
  engine._shortName = shortName;
}
