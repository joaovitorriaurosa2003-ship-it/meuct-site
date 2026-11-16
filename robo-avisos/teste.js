// Testes da logica do robo (sem banco): node teste.js
const assert = require("assert");
const L = require("./logica");

// Fuso: 13:00 UTC = 10:00 em Brasilia
assert.deepStrictEqual(L.agoraBrasil(new Date("2026-11-11T13:00:00Z")), { hoje: "2026-11-11", hhmm: "10:00" });
// 02:30 UTC ainda e o dia anterior em Brasilia
assert.deepStrictEqual(L.agoraBrasil(new Date("2026-11-12T02:30:00Z")), { hoje: "2026-11-11", hhmm: "23:30" });

const pessoais = [
  { id: "a", uid: "u1", titulo: "Consulta", data: "2026-11-10", lembrete_horas: ["08:00", "15:00"], lembrete_ate: "2026-11-12" },
  { id: "b", uid: "u2", titulo: "Antigo", data: "2026-11-01", lembrete_horas: ["08:00"], lembrete_ate: "2026-11-05" },
  { id: "c", uid: "u3", titulo: "Futuro", data: "2026-11-20", lembrete_horas: ["08:00"] },
  { id: "d", uid: "u4", titulo: "Hora ruim", data: "2026-11-01", lembrete_horas: ["8h", "25:99x"] },
];
const eventos = [
  { id: "e1", tipo: "jogo", adversario: "Franca", data: "2026-11-09", data_fim: "2026-11-15", lembrete_horas: ["08:00"], local: "Lanchão" },
  { id: "e2", tipo: "treino", data: "2026-11-01", lembrete_horas: ["08:00"], qts: true },
];
const equipe = ["u1", "u9"];

// 10:00: vence 08:00 de "a" e do jogo; os outros nao
let p = L.planejarLembretes({ hoje: "2026-11-11", hhmm: "10:00", eventos, pessoais, equipe });
assert.deepStrictEqual(p.map((x) => x.chave).sort(), ["e-e1_2026-11-11_0800", "p-a_2026-11-11_0800"]);
const jogo = p.find((x) => x.chave.startsWith("e-"));
assert.deepStrictEqual(jogo.uids, equipe);
assert.ok(jogo.corpo.startsWith("Meia Noite x Franca · Lanchão"));
assert.strictEqual(jogo.abrir, "agenda");
assert.strictEqual(jogo.tag, "lemb-e-e1");

// 07:59: nada
assert.strictEqual(L.planejarLembretes({ hoje: "2026-11-11", hhmm: "07:59", eventos, pessoais, equipe }).length, 0);
// 11:30: 08:00 passou de 3 h, nao manda mais
assert.strictEqual(L.planejarLembretes({ hoje: "2026-11-11", hhmm: "11:30", eventos, pessoais, equipe }).length, 0);
// 15:20: manda so o das 15:00 de "a"
p = L.planejarLembretes({ hoje: "2026-11-11", hhmm: "15:20", eventos, pessoais, equipe });
assert.deepStrictEqual(p.map((x) => x.chave), ["p-a_2026-11-11_1500"]);
// Atraso grande cobrindo os dois horarios (janela maior): manda um so, o ultimo, e cobre os dois
p = L.planejarLembretes({ hoje: "2026-11-11", hhmm: "15:20", eventos: [], pessoais, equipe, janela: 600 });
assert.strictEqual(p.length, 1);
assert.deepStrictEqual(p[0].horasCobertas, ["p-a_2026-11-11_0800", "p-a_2026-11-11_1500"]);
// Depois do "lembrar ate": nada
assert.strictEqual(L.planejarLembretes({ hoje: "2026-11-13", hhmm: "08:10", eventos: [], pessoais, equipe }).length, 0);

// Avisos
const agora = Date.now();
assert.strictEqual(L.avisoPendente({ destinatarios: ["x"] }, agora), true);
assert.strictEqual(L.avisoPendente({ destinatarios: ["x"], push_enviado_em: 1 }, agora), false);
assert.strictEqual(L.avisoPendente({ destinatarios: ["x"], push_reservado_em: agora - 60000 }, agora), false);
assert.strictEqual(L.avisoPendente({ destinatarios: ["x"], push_reservado_em: agora - 20 * 60000 }, agora), true);
assert.strictEqual(L.avisoPendente({ destinatarios: [] }, agora), false);
const m = L.mensagemDoAviso({ id: "z", destinatarios: ["a", "b", "a", "eu"], remetente_uid: "eu", remetente_nome: "Ana", nivel: "urgente", titulo: "Treino", mensagem: "Mudou para 15h" });
assert.deepStrictEqual(m.uids, ["a", "b"]);
assert.strictEqual(m.titulo, "Urgente: Treino");
assert.strictEqual(m.corpo, "Ana: Mudou para 15h");

assert.strictEqual(L.ehEquipe({ role: "admin" }), true);
assert.strictEqual(L.ehEquipe({ modulos: ["fisioterapia"] }), true);
assert.strictEqual(L.ehEquipe({ modulos: [] }), false);
// Jogos: lembrete diario as 8h nos 7 dias antes, para a comissao, com pendencias
const evJ = [
  { id: "j1", tipo: "jogo", adversario: "Franca", data: "2026-11-14", hora: "", local: "", categoria: "sub15", campeonato_id: "c1" },
  { id: "j0", tipo: "jogo", adversario: "Batatais", data: "2026-11-08", hora: "10:00", local: "CT", categoria: "sub15", campeonato_id: "c1",
    convocacao: { titulares: ["a1"], comissao: ["x"] }, pos_jogo: { atletas: { a1: { ca: 1 }, a2: { cv: 1 }, a3: { ca: 2 } } } },
  { id: "j2", tipo: "jogo", adversario: "Ribeirão", data: "2026-11-11", hora: "15:00", local: "Estádio", categoria: "sub17", convocacao: { titulares: ["a1"], comissao: ["x"] } },
  { id: "j3", tipo: "jogo", adversario: "Longe", data: "2026-11-30", categoria: "sub15" },
];
const camp = [{ id: "c1", amarelos_suspensao: 3 }];
const atl = { a2: { nome: "Bruno Silva", apelido: "Bruninho" }, a3: { nome: "Caio" } };
const usuarios = [{ id: "adm", role: "admin" }, { id: "t", modulos: ["treinador"] }, { id: "p", modulos: ["psicologia"] }, { id: "pf", modulos: ["preparacao"] }];
const com = usuarios.filter(L.ehComissao).map((u) => u.id);
assert.deepStrictEqual(com, ["adm", "t", "pf"]);
assert.strictEqual(L.planejarJogos({ hoje: "2026-11-11", hhmm: "07:40", eventos: evJ, campeonatos: camp, atletasPorId: atl, comissao: com }).length, 0);
let pj = L.planejarJogos({ hoje: "2026-11-11", hhmm: "08:20", eventos: evJ, campeonatos: camp, atletasPorId: atl, comissao: com });
assert.deepStrictEqual(pj.map((x) => x.chave), ["j-j2_2026-11-11", "j-j1_2026-11-11"]);
assert.ok(pj[0].titulo.startsWith("Hoje tem jogo · Meia Noite x Ribeirão"), pj[0].titulo);
assert.ok(pj[0].corpo.endsWith("Tudo certo para o jogo."), pj[0].corpo);
assert.ok(pj[1].titulo.startsWith("Faltam 3 dias · Meia Noite x Franca"), pj[1].titulo);
assert.ok(pj[1].corpo.includes("convocação não feita") && pj[1].corpo.includes("horário em aberto") && pj[1].corpo.includes("comissão do jogo não escolhida"), pj[1].corpo);
assert.ok(pj[1].corpo.includes("1 suspenso (Bruninho)") && pj[1].corpo.includes("1 pendurado (Caio)"), pj[1].corpo);
assert.strictEqual(pj[1].abrir, "jogos");
assert.deepStrictEqual(pj[1].uids, com);
pj = L.planejarJogos({ hoje: "2026-11-13", hhmm: "08:00", eventos: evJ, campeonatos: camp, atletasPorId: atl, comissao: com });
assert.ok(pj[0].titulo.startsWith("Amanhã tem jogo"), pj[0].titulo);
// passou de 11h: nao manda mais no dia
assert.strictEqual(L.planejarJogos({ hoje: "2026-11-11", hhmm: "11:30", eventos: evJ, campeonatos: camp, atletasPorId: atl, comissao: com }).length, 0);
console.log("ok: todos os testes passaram");
