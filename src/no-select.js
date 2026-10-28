// Round 15.12h: iOS Safari still starts a page selection on long-press when CSS is late or a canvas
// (the poem, the reaction picker) sits between selectable header text and the end of the board.
// selectstart / contextmenu are cancelled everywhere except real text fields. selectionchange
// collapses a selection that got through, which dismisses the Copy / Look Up / Translate callout.
// contextmenu is only preventDefault'd, so the reaction picker and the report hold still hear it.
// Compose inputs and the hidden textarea copyPoem uses for execCommand('copy') stay selectable.
(function () {
  var KEEP = 'input, textarea, [contenteditable="true"]';
  function keep(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return !!(el && el.closest && el.closest(KEEP));
  }
  document.addEventListener('selectstart', function (e) {
    if (keep(e.target)) return;
    e.preventDefault();
  }, true);
  document.addEventListener('contextmenu', function (e) {
    if (keep(e.target)) return;
    e.preventDefault();
  }, true);
  document.addEventListener('dragstart', function (e) {
    if (keep(e.target)) return;
    e.preventDefault();
  }, true);
  document.addEventListener('selectionchange', function () {
    var sel = document.getSelection && document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var n = sel.anchorNode;
    if (keep(n)) return;
    sel.removeAllRanges();
  });
})();
