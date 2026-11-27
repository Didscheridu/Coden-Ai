// DSGVO-Betroffenenrechte: Datenauskunft / -übertragbarkeit (Art. 15, 20 DSGVO) & Kontolöschung (Art. 17 DSGVO)
const express = require('express');
const db = require('./db');
const neon = require('./neon');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

const cleanDoc = (d) => {
  if (!d || typeof d !== 'object') return null;
  const { _id, _updateTime, ...rest } = d;
  void _id; void _updateTime;
  return rest;
};

function sanitizeSettingsExport(settings) {
  if (!settings || typeof settings !== 'object') return {};
  const s = { ...settings };
  delete s.apiKey;
  if (s.emailConfig && typeof s.emailConfig === 'object') {
    s.emailConfig = {
      provider: s.emailConfig.provider || '',
      address: s.emailConfig.address || ''
    };
  }
  return s;
}

async function queryOwned(col, field, uid) {
  return db.runQuery(col, { where: [[field, '==', uid]], limit: 0 }).catch(() => []);
}

async function exportAccountData(user) {
  const uid = user.uid;

  let neonData = null;
  let neonKeys = [];
  let neonModels = [];
  if (neon.isConfigured()) {
    try { neonData = (await neon.select('user_data', { uid }))[0] || null; } catch (_) {}
    try { neonKeys = await neon.select('byok_keys', { uid }); } catch (_) {}
    try { neonModels = await neon.select('byok_models', { uid }); } catch (_) {}
  }

  const [
    userDoc,
    subSessions,
    projects,
    apps,
    sharedArtifacts,
    scheduledTasks,
    taskResults,
    profile,
    mcpConnections,
    providerKeys,
    userModels,
    userChains,
    searchKeys,
    agentCfg,
    usage,
    studyPages,
    studyReminders,
    contactMessages
  ] = await Promise.all([
    db.getDoc(`user_data/${uid}`).catch(() => null),
    db.listDocs(`user_data/${uid}/sessions`, { limit: 500 }).catch(() => []),
    queryOwned('user_projects', 'uid', uid),
    queryOwned('apps', 'owner', uid),
    queryOwned('shared_artifacts', 'uid', uid),
    queryOwned('scheduled_tasks', 'uid', uid),
    queryOwned('task_results', 'uid', uid),
    db.getDoc(`profiles/${uid}`).catch(() => null),
    queryOwned('mcp_connections', 'uid', uid),
    queryOwned('user_provider_keys', 'uid', uid),
    queryOwned('user_models', 'uid', uid),
    queryOwned('user_chains', 'uid', uid),
    queryOwned('user_search_keys', 'uid', uid),
    db.getDoc(`user_agent_cfg/${uid}`).catch(() => null),
    db.getDoc(`usage_limits/${uid}`).catch(() => null),
    db.listDocs(`study/${uid}/pages`, { limit: 1000 }).catch(() => []),
    db.getDoc(`study_reminders/${uid}`).catch(() => null),
    queryOwned('contact_messages', 'uid', uid)
  ]);

  const chats = neonData && Array.isArray(neonData.sessions) && neonData.sessions.length
    ? neonData.sessions
    : (subSessions.length ? subSessions.map(cleanDoc) : (Array.isArray(userDoc?.sessions) ? userDoc.sessions : []));

  const settings = sanitizeSettingsExport(
    neonData && neonData.settings && typeof neonData.settings === 'object'
      ? neonData.settings
      : (userDoc?.settings || {})
  );

  // Geheimnisse (API-Keys, OAuth-Tokens, Passwörter, Preview-Tokens) werden NIEMALS mitexportiert
  const safeKeys = (neonKeys.length ? neonKeys : providerKeys).map(k => ({
    provider: k.provider,
    hint: k.hint || '',
    created_at: k.created_at || null
  }));
  const safeModels = (neonModels.length ? neonModels : userModels).map(cleanDoc);

  return {
    exportedAt: new Date().toISOString(),
    legalBasis: 'Art. 15 / Art. 20 DSGVO',
    service: 'Coden AI',
    account: {
      uid,
      email: user.email || null,
      emailVerified: !!user.emailVerified
    },
    profile: cleanDoc(profile),
    settings,
    chats,
    projects: projects.map(cleanDoc),
    apps: apps.map(a => {
      const c = cleanDoc(a);
      if (c) delete c.preview_token;
      return c;
    }),
    sharedArtifacts: sharedArtifacts.map(cleanDoc),
    scheduledTasks: scheduledTasks.map(cleanDoc),
    taskResults: taskResults.map(cleanDoc),
    mcpConnections: mcpConnections.map(c => ({
      id: c.id,
      name: c.name,
      url: c.url,
      catalog_id: c.catalog_id || null,
      auth_type: c.auth_type,
      enabled: !!c.enabled,
      scopes: c.scopes || '',
      allowed_repos: c.allowed_repos || null,
      created_at: c.created_at || null,
      updated_at: c.updated_at || null
    })),
    byok: {
      providers: safeKeys,
      models: safeModels,
      chains: userChains.map(cleanDoc),
      agentConfig: cleanDoc(agentCfg)
    },
    searchKeys: searchKeys.map(k => ({
      provider: k.provider,
      hint: k.hint || '',
      created_at: k.created_at || null
    })),
    study: {
      pagesCount: studyPages.length,
      pages: studyPages.map(cleanDoc),
      reminders: cleanDoc(studyReminders)
    },
    contactMessages: contactMessages.map(cleanDoc),
    usage: cleanDoc(usage)
  };
}

async function deleteCollectionByOwner(col, field, uid) {
  const rows = await queryOwned(col, field, uid);
  let count = 0;
  for (const r of rows) {
    const docId = r._id || r.id;
    if (!docId) continue;
    try {
      await db.deleteDoc(`${col}/${docId}`);
      count++;
    } catch (_) {}
  }
  return count;
}

async function deleteAccountData(user) {
  const uid = user.uid;
  const deleted = {};

  // 1. Chats & Einstellungen (user_data + sessions)
  try {
    await db.deleteTree(`user_data/${uid}`, ['sessions']);
    deleted.userData = true;
  } catch (_) {}

  // 2. Eigene Apps inkl. Routen, Previews & Subcollections
  const apps = await queryOwned('apps', 'owner', uid);
  deleted.apps = 0;
  for (const a of apps) {
    const id = a._id || a.id;
    if (a.slug) await db.deleteDoc(`app_routes/${a.slug}`).catch(() => {});
    if (a.preview_token) await db.deleteDoc(`app_previews/${a.preview_token}`).catch(() => {});
    if (id) {
      await db.deleteTree(`apps/${id}`, ['members', 'messages', 'secrets']).catch(() => {});
      deleted.apps++;
    }
  }

  // 3. Veröffentlichte Artefakte & geteilter Artefakt-Speicher
  const sharedArts = await queryOwned('shared_artifacts', 'uid', uid);
  deleted.sharedArtifacts = 0;
  for (const sa of sharedArts) {
    const aid = sa._id || sa.id;
    if (aid) {
      const sharedRows = await db.runQuery('artifact_shared', { where: [['aid', '==', aid]], limit: 0 }).catch(() => []);
      for (const sr of sharedRows) {
        if (sr._id) await db.deleteDoc(`artifact_shared/${sr._id}`).catch(() => {});
      }
      await db.deleteDoc(`shared_artifacts/${aid}`).catch(() => {});
      deleted.sharedArtifacts++;
    }
  }

  // 4. Buddy-Profil & Handle freigeben
  const profile = await db.getDoc(`profiles/${uid}`).catch(() => null);
  if (profile?.handle) {
    const hDoc = await db.getDoc(`buddy_handles/${profile.handle}`).catch(() => null);
    if (!hDoc || hDoc.uid === uid) {
      await db.deleteDoc(`buddy_handles/${profile.handle}`).catch(() => {});
    }
  }
  await db.deleteDoc(`profiles/${uid}`).catch(() => {});

  // 5. Alle nutzerbezogenen Sammlungen bereinigen
  const ownedCols = [
    ['user_projects', 'uid'],
    ['artifact_data', 'uid'],
    ['app_images', 'uid'],
    ['ai_runs', 'uid'],
    ['push_subs', 'uid'],
    ['user_provider_keys', 'uid'],
    ['user_models', 'uid'],
    ['user_chains', 'uid'],
    ['user_search_keys', 'uid'],
    ['scheduled_tasks', 'uid'],
    ['task_results', 'uid'],
    ['mcp_connections', 'uid'],
    ['contact_messages', 'uid'],
    ['buddy_projects', 'owner'],
    ['servers', 'owner']
  ];
  for (const [col, field] of ownedCols) {
    deleted[col] = await deleteCollectionByOwner(col, field, uid);
  }

  await db.deleteDoc(`user_agent_cfg/${uid}`).catch(() => {});
  await db.deleteTree(`study/${uid}`, ['pages']).catch(() => {});
  await db.deleteDoc(`study/${uid}/hand/master`).catch(() => {});
  await db.deleteDoc(`study_reminders/${uid}`).catch(() => {});

  // 6. Freundschaften & Direktnachrichten (participants array-contains uid)
  for (const col of ['friendships', 'dm_messages']) {
    const rows = await db.runQuery(col, { where: [['participants', 'ARRAY_CONTAINS', uid]], limit: 0 }).catch(() => []);
    for (const r of rows) {
      if (r._id) await db.deleteDoc(`${col}/${r._id}`).catch(() => {});
    }
  }

  // 7. Nutzungszähler: Firestore-Regeln erlauben Delete nur dem Admin -> falls nicht erlaubt, mindestens E-Mail/PII entfernen
  try {
    await db.deleteDoc(`usage_limits/${uid}`);
  } catch (_) {
    await db.updateDoc(`usage_limits/${uid}`, { email: '', updated_at: db.nowIso() }).catch(() => {});
  }

  // 8. Neon Postgres bereinigen (falls aktiv)
  if (neon.isConfigured()) {
    await neon.remove('user_data', { uid }).catch(() => {});
    await neon.remove('byok_keys', { uid }).catch(() => {});
    await neon.remove('byok_models', { uid }).catch(() => {});
  }

  return { ok: true, deleted };
}

function accountRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  r.get('/export', rateLimit('account-export', 5, 3600), async (req, res) => {
    const payload = await exportAccountData(req.user);
    res.set('Content-Disposition', 'attachment; filename="coden-ai-datenexport.json"');
    res.json(payload);
  });

  r.delete('/', rateLimit('account-del', 5, 3600), async (req, res) => {
    const result = await deleteAccountData(req.user);
    res.json(result);
  });

  return r;
}

module.exports = { accountRouter, exportAccountData, deleteAccountData };
