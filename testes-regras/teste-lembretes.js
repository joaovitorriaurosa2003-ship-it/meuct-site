// Teste da rodada de lembretes da função, no emulador do Firestore (FCM simulado).
process.env.MEUCT_TESTE = "1";
process.env.GCLOUD_PROJECT = "meuct-lemb"; process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "meuct-lemb" });
const path = process.argv[2];
const admin = require(path + "/node_modules/firebase-admin");
const enviados = [];
const m = require(path + "/index.js");
require(path + "/node_modules/firebase-admin/lib/messaging/messaging").Messaging.prototype.sendEachForMulticast = (async (x) => { enviados.push({ t: x.notification.title, b: x.notification.body, n: x.tokens.length, link: x.webpush.fcmOptions.link }); return { successCount: x.tokens.length, failureCount: 0, responses: x.tokens.map(() => ({ success: true })) }; });
const db = admin.firestore();
(async () => {
  const set = (c, id, d) => db.collection(c).doc(id).set(d);
  await set("ct_usuarios", "adm", { role: "admin", modulos: [] }); await set("ct_usuarios", "tec", { role: "colaborador", modulos: ["treinador"] }); await set("ct_usuarios", "psi", { role: "colaborador", modulos: ["psicologia"] });
  for (const [t, u] of [["tk1", "adm"], ["tk2", "tec"], ["tk3", "psi"]]) await set("ct_push_tokens", t, { uid: u, plataforma: "x" });
  await set("ct_eventos", "e1", { tipo: "reuniao", titulo: "Reunião geral", data: "2026-11-16", hora: "10:00", lembrete_horas: ["08:00"] });
  await set("ct_eventos", "e2", { tipo: "treino", data: "2026-11-16" });
  await set("ct_eventos", "j1", { tipo: "jogo", adversario: "Franca", data: "2026-11-19", categoria: "sub15", campeonato_id: "c1" });
  await set("ct_eventos", "j0", { tipo: "jogo", adversario: "Batatais", data: "2026-11-09", hora: "10:00", categoria: "sub15", campeonato_id: "c1", convocacao: { titulares: ["a1"], comissao: ["x"] }, pos_jogo: { atletas: { a1: { cv: 1 } } } });
  await set("ct_campeonatos", "c1", { nome: "Paulista", amarelos_suspensao: 3 });
  await set("ct_atletas", "a1", { nome: "Arthur Paiva" });
  await set("ct_agenda_pessoal", "p1", { uid: "psi", titulo: "Consulta", data: "2026-11-16", lembrete_horas: ["08:00"] });
  await set("ct_avisos", "av1", { destinatarios: ["tec"], remetente_uid: "adm", titulo: "Treino mudou", mensagem: "15h", nivel: "informativo", criado_em: admin.firestore.Timestamp.now() });
  console.log("tokens in:", (await db.collection("ct_push_tokens").where("uid", "in", ["adm","tec"]).get()).size, "todos:", (await db.collection("ct_push_tokens").get()).size, "mesmo admin:", require.resolve(path + "/node_modules/firebase-admin") === require.resolve("firebase-admin", { paths: [path] }));
  const r1 = await m._rodadaLembretes(new Date("2026-11-16T10:05:00Z")); // 07:05 em Brasília
  console.log("07:05", r1, enviados.splice(0));
  const r2 = await m._rodadaLembretes(new Date("2026-11-16T11:10:00Z")); // 08:10
  console.log("08:10", r2); enviados.splice(0).forEach((x) => console.log("  ->", x.t, "|", x.b, "|", x.n, "aparelho(s) |", x.link));
  const r3 = await m._rodadaLembretes(new Date("2026-11-16T11:25:00Z")); // 08:25: nada repetido
  console.log("08:25", r3, enviados.length);
  const av = (await db.collection("ct_avisos").doc("av1").get()).data();
  console.log("aviso:", av.push_via, av.push_aparelhos);
  process.exit(0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
