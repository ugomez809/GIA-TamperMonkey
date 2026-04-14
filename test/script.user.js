// ==UserScript==
// @name         GIA Test Script
// @version      1.0.0
// @description  Test script for auto-update
// @match        https://www.google.com/*
// @updateURL    https://oauth2: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@raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/test/script.meta.js
// @downloadURL  https://oauth2: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@raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/test/script.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    var banner = document.createElement('div');
    banner.textContent = 'GIA Test Script v1.0.0 is running!';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#4CAF50;color:white;text-align:center;padding:10px;font-size:16px;z-index:99999;';
    document.body.appendChild(banner);
})();
