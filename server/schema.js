// Firestore ist schemalos; ensureSchema prüft lediglich die Firebase-Konfiguration/Erreichbarkeit einmal pro Start.
const { getConfig, isMemoryDb, ping } = require('./firestore');

let done = null;
function ensureSchema() {
  if (!done) {
    done = (async () => {
      const cfg = getConfig();
      if (!cfg.projectId) return false;
      if (!isMemoryDb()) await ping();
      return true;
    })().catch((e) => {
      done = null;
      console.error('ensureSchema:', e.message);
      return false;
    });
  }
  return done;
}

module.exports = { ensureSchema };
