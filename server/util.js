// Express 4 fängt Fehler in async-Handlern nicht selbst ab -> weiterreichen
function wrapRouter(router) {
  for (const m of ['get', 'put', 'post', 'delete']) {
    const orig = router[m].bind(router);
    router[m] = (path, ...hs) => orig(path, ...hs.map(h => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)));
  }
  return router;
}
module.exports = { wrapRouter };
