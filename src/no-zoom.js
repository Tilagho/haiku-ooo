// No zoom on iOS (Tiago: no double-tap zoom, no pinch zoom). Double-tap zoom is turned off by CSS
// `touch-action: manipulation` (src/style.css), which keeps quick repeated taps (poking Inky) fast. Safari ignores
// user-scalable=no in the viewport meta, so pinches are blocked here: its gesture* events, and any touchmove with
// more than one finger. One-finger scrolling, noren corner drags, Inky taps and scroll gusts are untouched.
(function () {
  var stop = function (e) { e.preventDefault(); };
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) { document.addEventListener(t, stop, { passive: false }); });
  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
})();
