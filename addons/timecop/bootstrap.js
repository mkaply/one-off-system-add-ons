/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/* We need to disable these because this system add-on
 * goes back to Firefox 43 */

/* eslint-disable mozilla/no-define-cc-etc */
/* eslint-disable mozilla/use-chromeutils-import */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

const BROWSER_SEARCH_PREF = "browser.search.";

let gInstall = false;

function install(aData, aReason) {
  // We check for install here instead of in startup because
  // In Firefox 46, the install reason didn't work properly
  // in startup in some cases.
  if (aReason != 5 /* ADDON_INSTALL */) {
    return;
  }
  gInstall = true;
}

function uninstall(aData, aReason) {}

function startup(aData, aReason) {
  if (!gInstall) {
    return;
  }
  Services.prefs.setBoolPref(BROWSER_SEARCH_PREF + "reset.geo", true);
}

function shutdown(aData, aReason) {
  if (aReason != 2 /* APP_SHUTDOWN */) {
    return;
  }
  try {
    let geoReset = Services.prefs.getBoolPref(BROWSER_SEARCH_PREF + "reset.geo", false);
    if (geoReset) {
      Services.prefs.clearUserPref(BROWSER_SEARCH_PREF + "region");
      Services.prefs.clearUserPref(BROWSER_SEARCH_PREF + "countryCode");
      Services.prefs.clearUserPref(BROWSER_SEARCH_PREF + "isUS");
      Services.prefs.clearUserPref(BROWSER_SEARCH_PREF + "reset.geo");
    }
  } catch (e) {}
}
