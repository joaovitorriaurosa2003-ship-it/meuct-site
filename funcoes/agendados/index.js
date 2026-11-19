// MeuCT: avisos agendados.
// A cada 5 minutos, os avisos de ct_avisos_agendados cujo horário já chegou viram um aviso normal em
// ct_avisos. A criação em ct_avisos dispara a função avisoNaHora (codebase "meuct"), que manda a
// notificação no celular. Esta codebase é separada para ser publicada sem mexer nas outras funções:
//   firebase deploy --only functions:agendados
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();
const CAMPOS = ["remetente_uid", "remetente_nome", "destinatarios", "nomes", "alvo_texto", "nivel", "titulo", "mensagem", "evento_id"];

async function rodadaAgendados(agora) {
  const ate = Timestamp.fromDate(agora || new Date());
  // Só pelo horário (não precisa de índice composto); o status é conferido aqui e na transação.
  const s = await db.collection("ct_avisos_agendados").where("enviar_em", "<=", ate).orderBy("enviar_em").limit(100).get();
  let enviados = 0, falhas = 0;
  for (const d of s.docs) {
    if ((d.data() || {}).status !== "agendado") continue;
    try {
      const ok = await db.runTransaction(async (tx) => {
        const atual = await tx.get(d.ref);
        const a = atual.exists ? atual.data() : null;
        if (!a || a.status !== "agendado") return false;
        const destino = db.collection("ct_avisos").doc();
        const aviso = { lidos: {}, criado_em: FieldValue.serverTimestamp(), agendado_id: d.id, agendado_para: a.enviar_em };
        CAMPOS.forEach((k) => { if (a[k] !== undefined) aviso[k] = a[k]; });
        tx.create(destino, aviso);
        tx.update(d.ref, { status: "enviado", aviso_id: destino.id, enviado_em: FieldValue.serverTimestamp() });
        return true;
      });
      if (ok) enviados++;
    } catch (e) {
      falhas++;
      functions.logger.error("Aviso agendado falhou", { id: d.id, erro: String((e && e.message) || e) });
    }
  }
  if (enviados || falhas) functions.logger.info("Rodada de avisos agendados", { enviados, falhas });
  return { enviados, falhas };
}
if (process.env.MEUCT_TESTE) exports._rodadaAgendados = rodadaAgendados; // só no teste

exports.avisosAgendados = functions
  .region("southamerica-east1")
  .runWith({ maxInstances: 1, timeoutSeconds: 60, memory: "256MB" })
  .pubsub.schedule("every 5 minutes")
  .timeZone("America/Sao_Paulo")
  .onRun(() => rodadaAgendados(new Date()));
