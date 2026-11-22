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

// Lembrete de prazo dos encaminhamentos: todo dia às 7h30 (Brasília), avisa o setor que recebeu
// cada encaminhamento em aberto que vence hoje ou já passou do prazo. Um lembrete por dia por encaminhamento.
const NOMES_SETOR = { fisioterapia: "Fisioterapia", medicina: "Medicina", nutricao: "Nutrição", psicologia: "Psicologia", social: "Serviço Social", preparacao: "Preparação Física", treinador: "Comissão técnica", diretoria: "Diretoria" };
function hojeSaoPaulo(agora) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora || new Date());
  return p; // AAAA-MM-DD
}
async function rodadaLembretesEncaminhamentos(agora) {
  const hoje = hojeSaoPaulo(agora);
  const s = await db.collection("ct_encaminhamentos").where("prazo_data", "<=", hoje).limit(300).get();
  const abertos = s.docs.filter((d) => { const e = d.data() || {}; return e.prazo_data && e.status !== "atendido" && e.lembrete_prazo !== hoje; });
  if (!abertos.length) return { enviados: 0 };
  const dir = (await db.collection("ct_diretorio").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let enviados = 0;
  for (const d of abertos) {
    const e = d.data();
    const dest = dir.filter((u) => (u.modulos || []).includes(e.para_setor)).map((u) => u.id).slice(0, 300);
    try {
      const atrasado = e.prazo_data < hoje;
      if (dest.length) {
        const nomes = {}; dest.forEach((u) => { nomes[u] = ""; });
        const quem = e.atleta_nome ? e.atleta_nome + " · " : "";
        await db.collection("ct_avisos").add({
          remetente_uid: e.de_uid || "", remetente_nome: "MeuCT", destinatarios: dest, nomes,
          alvo_texto: NOMES_SETOR[e.para_setor] || e.para_setor || "", nivel: atrasado ? "vermelho" : "amarelo",
          titulo: ((atrasado ? "Encaminhamento atrasado: " : "Encaminhamento vence hoje: ") + quem + (e.assunto || "")).slice(0, 120),
          mensagem: ((NOMES_SETOR[e.de_setor] || e.de_nome || "Outro setor") + " encaminhou para " + (NOMES_SETOR[e.para_setor] || e.para_setor) + ". Prazo: " + e.prazo_data.split("-").reverse().join("/") + ". Abra Encaminhamentos no MeuCT para dar o próximo passo.").slice(0, 900),
          lidos: {}, criado_em: FieldValue.serverTimestamp(), origem: "lembrete_encaminhamento", encaminhamento_id: d.id,
        });
        enviados++;
      }
      await d.ref.update({ lembrete_prazo: hoje });
    } catch (err) {
      functions.logger.error("Lembrete de encaminhamento falhou", { id: d.id, erro: String((err && err.message) || err) });
    }
  }
  functions.logger.info("Lembretes de encaminhamento", { enviados, abertos: abertos.length });
  return { enviados };
}
if (process.env.MEUCT_TESTE) exports._rodadaLembretesEncaminhamentos = rodadaLembretesEncaminhamentos; // só no teste

exports.lembretesEncaminhamentos = functions
  .region("southamerica-east1")
  .runWith({ maxInstances: 1, timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("30 7 * * *")
  .timeZone("America/Sao_Paulo")
  .onRun(() => rodadaLembretesEncaminhamentos(new Date()));
