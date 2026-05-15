// ==UserScript==
// @name         Auto Mouse Movement & Scroll Script
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Moves the mouse randomly and scrolls up/down. Stops on key press (Escape). Excludes AgencyZoom dashboard.
// @author       You
// @match        *://*/*
// @exclude      https://app.agencyzoom.com/dashboard/index
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/auto-mouse-movement-scroll.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/auto-mouse-movement-scroll.user.js
// ==/UserScript==

(function() {
    'use strict';

    let running = true; // Controls the script execution

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function simulateMouseMove() {
        const x = getRandomInt(0, window.innerWidth);
        const y = getRandomInt(0, window.innerHeight);

        const event = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
        });

        document.dispatchEvent(event);
    }

    function simulateScroll() {
        const scrollAmount = getRandomInt(-300, 300); // Scrolls up or down randomly
        window.scrollBy({
            top: scrollAmount,
            behavior: 'smooth'
        });
    }

    function runAutomation() {
        if (!running) return;

        simulateMouseMove(); // Move the mouse
        simulateScroll(); // Scroll the page

        setTimeout(runAutomation, getRandomInt(500, 2000)); // Random interval between actions
    }

    // Key event to stop the script (Escape key)
    document.addEventListener('keydown', (event) => {
        if (event.key === "Escape") {
            running = false;
            console.log("Script stopped!");
        }
    });

    // Start the automation
    runAutomation();

})();