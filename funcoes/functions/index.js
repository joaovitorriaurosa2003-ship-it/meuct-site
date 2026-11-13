// MeuCT: notificações no celular.
// avisoNaHora: aviso da equipe vira notificação na hora.
// mensagemNaHora: mensagem das Conversas vira notificação na hora.
// lembretesAgendados: a cada 15 min (6h às 23h45): lembretes da agenda, Minha agenda,
// lembrete diário dos jogos às 8h e reserva para algum aviso que tenha ficado sem notificação.
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const L = require("./logica");

admin.initializeApp();
const db = admin.firestore();

const APP_URL = "https://meuct.meianoitesaf.com/";
const RESERVA_MIN = 15;
const INVALIDOS = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

function corta(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }

function pendente(a, agoraMs) {
  if (!a || a.push_enviado_em) return false;
  if (!Array.isArray(a.destinatarios) || !a.destinatarios.length) return false;
  const r = a.push_reservado_em;
  const rMs = r && typeof r.toMillis === "function" ? r.toMillis() : null;
  return !rMs || agoraMs - rMs > RESERVA_MIN * 60000;
}

function mensagem(a, id) {
  return {
    uids: Array.from(new Set(a.destinatarios.filter((u) => u && u !== a.remetente_uid))),
    titulo: corta((a.nivel === "urgente" ? "Urgente: " : "") + (a.titulo || "Novo aviso"), 110),
    corpo: corta([a.remetente_nome ? a.remetente_nome + ":" : "", a.mensagem || ""].filter(Boolean).join(" "), 230),
    tag: "aviso-" + id,
  };
}

async function aparelhos(uids) {
  const tokens = [];
  for (let i = 0; i < uids.length; i += 30) {
    const s = await db.collection("ct_push_tokens").where("uid", "in", uids.slice(i, i + 30)).get();
    s.docs.forEach((d) => tokens.push(d.id));
  }
  return Array.from(new Set(tokens));
}

exports.avisoNaHora = functions
  .region("southamerica-east1")
  .runWith({ maxInstances: 3, timeoutSeconds: 60, memory: "256MB" })
  .firestore.document("ct_avisos/{id}")
  .onCreate(async (snap, ctx) => {
    const id = ctx.params.id;
    const ref = snap.ref;
    // Reserva o aviso (evita mandar duas vezes se o robô passar ao mesmo tempo).
    const reservou = await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!atual.exists || !pendente(atual.data(), Date.now())) return false;
      tx.update(ref, { push_reservado_em: FieldValue.serverTimestamp() });
      return true;
    });
    if (!reservou) { functions.logger.info("Aviso já tratado", { id }); return; }

    const msg = mensagem(snap.data(), id);
    const tokens = await aparelhos(msg.uids);
    let ok = 0, falha = 0;
    const lixo = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const lote = tokens.slice(i, i + 500);
      const r = await admin.messaging().sendEachForMulticast({
        tokens: lote,
        notification: { title: msg.titulo, body: msg.corpo },
        data: { abrir: "avisos", tag: msg.tag },
        webpush: {
          headers: { Urgency: "high", TTL: "21600" },
          notification: { icon: APP_URL + "icon-192.png", badge: APP_URL + "favicon-32.png", tag: msg.tag },
          fcmOptions: { link: APP_URL + "index.html?abrir=avisos" },
        },
      });
      ok += r.successCount; falha += r.failureCount;
      r.responses.forEach((x, j) => { if (!x.success && x.error && INVALIDOS.has(x.error.code)) lixo.push(lote[j]); });
    }
    await Promise.all(lixo.map((t) => db.collection("ct_push_tokens").doc(t).delete().catch(() => null)));
    await ref.update({ push_enviado_em: FieldValue.serverTimestamp(), push_aparelhos: ok, push_via: "funcao" });
    functions.logger.info("Aviso enviado", { id, aparelhos: ok, falhas: falha, removidos: lixo.length });
  });

// Conversas da equipe: notificação na hora para os participantes (menos quem enviou,
// quem silenciou a conversa e quem está com ela aberta agora).
exports.mensagemNaHora = functions
  .region("southamerica-east1")
  .runWith({ maxInstances: 5, timeoutSeconds: 60, memory: "256MB" })
  .firestore.document("ct_conversas/{cid}/mensagens/{mid}")
  .onCreate(async (snap, ctx) => {
    const m = snap.data() || {};
    if (m.apagada || !m.texto) return;
    const cid = ctx.params.cid;
    const conv = await db.collection("ct_conversas").doc(cid).get();
    if (!conv.exists) return;
    const c = conv.data();
    const agora = Date.now();
    const lido = c.lido_em || {};
    const mudo = c.silenciado || {};
    const uids = (c.membros || []).filter((u) => u && u !== m.autor_uid && !mudo[u]
      && !(lido[u] && typeof lido[u].toMillis === "function" && agora - lido[u].toMillis() < 45000));
    if (!uids.length) return;
    const tokens = await aparelhos(uids);
    if (!tokens.length) return;
    const titulo = c.tipo === "direta" ? (m.autor_nome || "Mensagem") : (c.nome || "Grupo");
    const corpo = corta((c.tipo === "direta" ? "" : (m.autor_nome || "").split(" ")[0] + ": ") + m.texto, 230);
    const tag = "chat-" + cid;
    let ok = 0;
    const lixo = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const lote = tokens.slice(i, i + 500);
      const r = await admin.messaging().sendEachForMulticast({
        tokens: lote,
        notification: { title: corta(titulo, 110), body: corpo },
        data: { abrir: "conversas", c: cid, tag },
        webpush: {
          headers: { Urgency: "high", TTL: "21600" },
          notification: { icon: APP_URL + "icon-192.png", badge: APP_URL + "favicon-32.png", tag, renotify: true },
          fcmOptions: { link: APP_URL + "index.html?abrir=conversas&c=" + encodeURIComponent(cid) },
        },
      });
      ok += r.successCount;
      r.responses.forEach((x, j) => { if (!x.success && x.error && INVALIDOS.has(x.error.code)) lixo.push(lote[j]); });
    }
    await Promise.all(lixo.map((t) => db.collection("ct_push_tokens").doc(t).delete().catch(() => null)));
    functions.logger.info("Mensagem notificada", { cid, aparelhos: ok, removidos: lixo.length });
  });

/* ---------- Lembretes agendados (antes era o robô do GitHub) ---------- */
async function enviarPara(uids, msg) {
  const tokens = await aparelhos(Array.from(new Set(uids)));
  if (!tokens.length) return { ok: 0, semAparelho: true };
  let ok = 0;
  const lixo = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const lote = tokens.slice(i, i + 500);
    const r = await admin.messaging().sendEachForMulticast({
      tokens: lote,
      notification: { title: msg.titulo, body: msg.corpo },
      data: { abrir: msg.abrir, tag: msg.tag },
      webpush: {
        headers: { Urgency: "high", TTL: "21600" },
        notification: { icon: APP_URL + "icon-192.png", badge: APP_URL + "favicon-32.png", tag: msg.tag },
        fcmOptions: { link: APP_URL + "index.html?abrir=" + encodeURIComponent(msg.abrir) },
      },
    });
    ok += r.successCount;
    r.responses.forEach((x, j) => { if (!x.success && x.error && INVALIDOS.has(x.error.code)) lixo.push(lote[j]); });
  }
  await Promise.all(lixo.map((t) => db.collection("ct_push_tokens").doc(t).delete().catch(() => null)));
  return { ok, removidos: lixo.length };
}
const docs = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));

/** Uma rodada: o que venceu agora (agenda, Minha agenda, jogos às 8h) e avisos que ficaram sem notificação. */
async function rodadaLembretes(agora) {
  const { hoje, hhmm } = L.agoraBrasil(agora);
  const [eventosLemb, pessoais, usuarios] = await Promise.all([
    db.collection("ct_eventos").where("lembrete_horas", "!=", null).get().then(docs),
    db.collection("ct_agenda_pessoal").where("lembrete_horas", "!=", null).get().then(docs),
    db.collection("ct_usuarios").get().then(docs),
  ]);
  const equipe = usuarios.filter(L.ehEquipe).map((u) => u.id);
  const plano = L.planejarLembretes({ hoje, hhmm, equipe, eventos: eventosLemb.filter((e) => L.horasValidas(e).length), pessoais: pessoais.filter((c) => L.horasValidas(c).length) });
  // Jogos: só na janela da manhã (o lembrete é às 8h)
  if (hhmm >= "08:00" && hhmm <= "11:00") {
    const ate = new Date(Date.parse(hoje + "T12:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
    const jogos = (await db.collection("ct_eventos").where("data", ">=", hoje).where("data", "<=", ate).get().then(docs)).filter((e) => e.tipo === "jogo");
    if (jogos.length) {
      const ids = Array.from(new Set(jogos.map((j) => j.campeonato_id).filter(Boolean)));
      const campeonatos = (await Promise.all(ids.map((id) => db.collection("ct_campeonatos").doc(id).get()))).filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }));
      const anteriores = (await Promise.all(ids.map((id) => db.collection("ct_eventos").where("campeonato_id", "==", id).get().then(docs)))).flat();
      const atletas = ids.length ? await db.collection("ct_atletas").get().then(docs) : [];
      const todos = Object.values(Object.fromEntries([...anteriores, ...jogos].map((e) => [e.id, e])));
      plano.push(...L.planejarJogos({ hoje, hhmm, eventos: todos, campeonatos, atletasPorId: Object.fromEntries(atletas.map((a) => [a.id, a])), comissao: usuarios.filter(L.ehComissao).map((u) => u.id) }));
    }
  }
  let n = 0;
  for (const p of plano) {
    const ja = await Promise.all(p.horasCobertas.map((c) => db.collection("ct_lembretes_enviados").doc(c).get()));
    if (ja.some((s) => s.exists)) continue;
    const ref = db.collection("ct_lembretes_enviados").doc(p.chave);
    try { await ref.create({ enviado_em: FieldValue.serverTimestamp(), uids: p.uids.length, via: "funcao" }); }
    catch (e) { if (e.code === 6 || /already exists/i.test(e.message)) continue; throw e; }
    try {
      const r = await enviarPara(p.uids, p);
      functions.logger.info("Lembrete enviado", { chave: p.chave, aparelhos: r.ok || 0 });
      n++;
    } catch (e) { await ref.delete().catch(() => null); throw e; }
  }
  // Reserva dos avisos: se a função do aviso falhou, manda agora (sem repetir)
  const desde = admin.firestore.Timestamp.fromMillis(Date.now() - 6 * 3600000);
  const avisos = await db.collection("ct_avisos").where("criado_em", ">=", desde).get();
  for (const d of avisos.docs) {
    const a = d.data();
    if (!pendente(a, Date.now())) continue;
    const reservou = await db.runTransaction(async (tx) => {
      const atual = await tx.get(d.ref);
      if (!atual.exists || !pendente(atual.data(), Date.now())) return false;
      tx.update(d.ref, { push_reservado_em: FieldValue.serverTimestamp() });
      return true;
    });
    if (!reservou) continue;
    const m = mensagem(a, d.id);
    const r = await enviarPara(m.uids, { ...m, abrir: "avisos" });
    await d.ref.update({ push_enviado_em: FieldValue.serverTimestamp(), push_aparelhos: r.ok || 0, push_via: "reserva" });
    functions.logger.info("Aviso enviado pela reserva", { id: d.id, aparelhos: r.ok || 0 });
  }
  // Faxina do controle (mais de 30 dias)
  const velho = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400000);
  const s = await db.collection("ct_lembretes_enviados").where("enviado_em", "<", velho).limit(300).get();
  if (!s.empty) { const b = db.batch(); s.docs.forEach((x) => b.delete(x.ref)); await b.commit(); }
  functions.logger.info("Rodada de lembretes", { hoje, hhmm, vencendo: plano.length, enviados: n });
  return { hoje, hhmm, vencendo: plano.length, enviados: n };
}
if (process.env.MEUCT_TESTE) exports._rodadaLembretes = rodadaLembretes; // só no teste

exports.lembretesAgendados = functions
  .region("southamerica-east1")
  .runWith({ maxInstances: 1, timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("*/15 6-23 * * *")
  .timeZone("America/Sao_Paulo")
  .onRun(() => rodadaLembretes(new Date()));
