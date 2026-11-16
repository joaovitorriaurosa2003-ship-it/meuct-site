// Robo de avisos do MeuCT. Roda no GitHub Actions a cada 20 minutos (06h as 22h40, horario de Brasilia).
// 1) Manda para o celular/computador os avisos da equipe que ainda nao viraram notificacao.
// 2) Manda os lembretes diarios (agenda do clube e Minha agenda) que venceram.
// 3) Todo dia as 8h: lembrete dos jogos da semana (quantos dias faltam e o que esta pendente) para a comissao.
// A chave do Firebase vem do segredo FIREBASE_SERVICE_ACCOUNT do repositorio; nunca fica no codigo.

const admin = require("firebase-admin");
const L = require("./logica");

const APP_URL = (process.env.APP_URL || "https://meuct.meianoitesaf.com/").replace(/\/?$/, "/");
const TESTE = process.env.TESTE === "1"; // so mostra o que mandaria, sem enviar nem gravar
const JANELA_AVISOS_H = 6;

function iniciar() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) throw new Error("Falta o segredo FIREBASE_SERVICE_ACCOUNT no repositório (Settings > Secrets and variables > Actions).");
  let conta;
  try { conta = JSON.parse(bruto); } catch (e) { throw new Error("O segredo FIREBASE_SERVICE_ACCOUNT não é um JSON válido. Cole o conteúdo inteiro do arquivo baixado do Firebase."); }
  admin.initializeApp({ credential: admin.credential.cert(conta) });
  return admin.firestore();
}

const lerTudo = async (db, col) => (await db.collection(col).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function aparelhosPorPessoa(db) {
  const mapa = {};
  (await db.collection("ct_push_tokens").get()).docs.forEach((d) => {
    const uid = d.data().uid;
    if (uid) (mapa[uid] = mapa[uid] || []).push(d.id);
  });
  return mapa;
}

const INVALIDOS = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

/** Envia para todos os aparelhos das pessoas e apaga os aparelhos que nao existem mais. */
async function enviar(db, aparelhos, msg) {
  const tokens = Array.from(new Set(msg.uids.flatMap((u) => aparelhos[u] || [])));
  if (!tokens.length) return { ok: 0, falha: 0, semAparelho: true };
  if (TESTE) { console.log("[teste] mandaria:", msg.titulo, "|", msg.corpo, "| aparelhos:", tokens.length); return { ok: tokens.length, falha: 0 }; }
  let ok = 0, falha = 0;
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
    ok += r.successCount; falha += r.failureCount;
    r.responses.forEach((x, j) => { if (!x.success && x.error && INVALIDOS.has(x.error.code)) lixo.push(lote[j]); });
  }
  if (lixo.length) {
    await Promise.all(lixo.map((t) => db.collection("ct_push_tokens").doc(t).delete().catch(() => null)));
    lixo.forEach((t) => Object.keys(aparelhos).forEach((u) => { aparelhos[u] = aparelhos[u].filter((x) => x !== t); }));
  }
  return { ok, falha, removidos: lixo.length };
}

async function rodadaAvisos(db, aparelhos) {
  const desde = admin.firestore.Timestamp.fromMillis(Date.now() - JANELA_AVISOS_H * 3600000);
  const snap = await db.collection("ct_avisos").where("criado_em", ">=", desde).get();
  let n = 0;
  for (const d of snap.docs) {
    const a = { id: d.id, ...d.data() };
    if (!L.avisoPendente(a, Date.now())) continue;
    // Reserva o aviso para esta rodada (evita mandar duas vezes se duas rodadas se cruzarem).
    if (!TESTE) {
      const reservou = await db.runTransaction(async (tx) => {
        const atual = await tx.get(d.ref);
        if (!atual.exists || !L.avisoPendente({ id: d.id, ...atual.data() }, Date.now())) return false;
        tx.update(d.ref, { push_reservado_em: admin.firestore.FieldValue.serverTimestamp() });
        return true;
      });
      if (!reservou) continue;
    }
    const msg = L.mensagemDoAviso(a);
    const r = await enviar(db, aparelhos, msg);
    if (!TESTE) await d.ref.update({ push_enviado_em: admin.firestore.FieldValue.serverTimestamp(), push_aparelhos: r.ok || 0 });
    console.log(`Aviso ${d.id}: ${r.ok || 0} aparelho(s)` + (r.falha ? `, ${r.falha} falha(s)` : "") + (r.semAparelho ? " (ninguém com notificação ligada)" : ""));
    n++;
  }
  return n;
}

async function rodadaLembretes(db, aparelhos) {
  const { hoje, hhmm } = L.agoraBrasil();
  const [eventos, pessoais, usuarios] = await Promise.all([lerTudo(db, "ct_eventos"), lerTudo(db, "ct_agenda_pessoal"), lerTudo(db, "ct_usuarios")]);
  const equipe = usuarios.filter(L.ehEquipe).map((u) => u.id);
  const plano = L.planejarLembretes({
    hoje, hhmm, equipe,
    eventos: eventos.filter((e) => L.horasValidas(e).length),
    pessoais: pessoais.filter((c) => L.horasValidas(c).length),
  });
  // Jogos dos proximos 7 dias: sempre tem lembrete (as 8h), com quanto falta e o que esta pendente.
  const jogosPerto = eventos.filter((e) => e.tipo === "jogo" && e.data && L.diasEntre(hoje, e.data) >= 0 && L.diasEntre(hoje, e.data) <= 7);
  if (jogosPerto.length) {
    const [campeonatos, atletas] = await Promise.all([lerTudo(db, "ct_campeonatos").catch(() => []), lerTudo(db, "ct_atletas").catch(() => [])]);
    plano.push(...L.planejarJogos({ hoje, hhmm, eventos, campeonatos, atletasPorId: Object.fromEntries(atletas.map((a) => [a.id, a])), comissao: usuarios.filter(L.ehComissao).map((u) => u.id) }));
  }
  console.log(`Agora em Brasília: ${hoje} ${hhmm}. Lembretes vencendo: ${plano.length}.`);
  let n = 0;
  for (const p of plano) {
    const ref = db.collection("ct_lembretes_enviados").doc(p.chave);
    if (!TESTE) {
      // Se algum horario coberto ja foi enviado, nao repete.
      const ja = await Promise.all(p.horasCobertas.map((c) => db.collection("ct_lembretes_enviados").doc(c).get()));
      if (ja.some((s) => s.exists)) continue;
      try { await ref.create({ enviado_em: admin.firestore.FieldValue.serverTimestamp(), uids: p.uids.length }); }
      catch (e) { if (e.code === 6 || /already exists/i.test(e.message)) continue; throw e; }
    }
    try {
      const r = await enviar(db, aparelhos, p);
      console.log(`Lembrete ${p.chave}: ${r.ok || 0} aparelho(s)` + (r.semAparelho ? " (ninguém com notificação ligada)" : ""));
      n++;
    } catch (e) {
      if (!TESTE) await ref.delete().catch(() => null); // tenta de novo na proxima rodada
      throw e;
    }
  }
  return n;
}

/** Limpa o controle de lembretes com mais de 30 dias. */
async function faxina(db) {
  if (TESTE) return;
  const velho = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400000);
  const s = await db.collection("ct_lembretes_enviados").where("enviado_em", "<", velho).limit(300).get();
  if (!s.empty) { const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
}

(async () => {
  const db = iniciar();
  const aparelhos = await aparelhosPorPessoa(db);
  console.log(`Aparelhos com notificação ligada: ${Object.values(aparelhos).reduce((s, l) => s + l.length, 0)}.`);
  let erro = null;
  const av = await rodadaAvisos(db, aparelhos).catch((e) => { erro = e; console.error("Erro nos avisos:", e.message); return 0; });
  const lb = await rodadaLembretes(db, aparelhos).catch((e) => { erro = e; console.error("Erro nos lembretes:", e.message); return 0; });
  await faxina(db).catch(() => null);
  console.log(`Fim: ${av} aviso(s) e ${lb} lembrete(s) enviados.`);
  if (erro) process.exit(1);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
