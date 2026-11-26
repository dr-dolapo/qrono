// Hero: types each event kind in turn ("live events" → "church services" → …), deleting the
// last one first. Screen readers get the fixed heading (aria-label). With reduced motion on,
// the words swap every few seconds instead of being typed.
(function () {
  var el = document.querySelector(".typed[data-words]");
  if (!el) return;
  var words = el.getAttribute("data-words").split("|");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var i = 0;
  var text = words[0];

  if (reduce) {
    el.classList.add("still");
    setInterval(function () {
      i = (i + 1) % words.length;
      el.textContent = words[i];
    }, 2800);
    return;
  }

  function wait(ms, next) { setTimeout(next, ms); }
  function erase() {
    if (text.length === 0) { i = (i + 1) % words.length; return wait(250, type); }
    text = text.slice(0, -1);
    el.textContent = text;
    wait(38, erase);
  }
  function type() {
    var target = words[i];
    if (text === target) return wait(2200, erase);
    text = target.slice(0, text.length + 1);
    el.textContent = text;
    wait(70, type);
  }
  wait(2200, erase);
})();
