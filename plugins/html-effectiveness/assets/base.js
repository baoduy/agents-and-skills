// Shared interactions: theme toggle, search, nav, copy-on-click. Populated from upstream during Task 7.
(function () {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-copy]');
    if (!t) return;
    const text = t.getAttribute('data-copy');
    navigator.clipboard?.writeText(text);
    t.setAttribute('data-copied', '1');
    setTimeout(() => t.removeAttribute('data-copied'), 1000);
  });
})();
