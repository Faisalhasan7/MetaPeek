/* Applied before first paint to avoid a light→dark flash. */
(function () {
  var t = null;
  try { t = localStorage.getItem('metapeek-theme'); } catch (e) {}
  if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
