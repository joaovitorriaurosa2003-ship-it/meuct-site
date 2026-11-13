// Testes das regras do Firestore do MeuCT no emulador (banco de teste local, nada em produção).
// Uso: node teste-regras.mjs <arquivo.rules>
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync, writeFileSync } from "fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";

const arq = process.argv[2] || "firestore.rules";
const env = await initializeTestEnvironment({ projectId: "meuct-teste", firestore: { rules: readFileSync(arq, "utf8"), host: "127.0.0.1", port: 8089 } });
await env.clearFirestore();

const U = {
  admin: { role: "admin", modulos: [], email: "joaovitorriaurosa2003@gmail.com" },
  fisio: { role: "colaborador", modulos: ["fisioterapia"], email: "fisio@clube.com" },
  nutri: { role: "colaborador", modulos: ["nutricao"], email: "nutri@clube.com" },
  social: { role: "colaborador", modulos: ["social"], email: "social@clube.com" },
  treinador: { role: "colaborador", modulos: ["treinador"], email: "tec@clube.com" },
  diretoria: { role: "colaborador", modulos: ["diretoria"], email: "dir@clube.com" },
  psi: { role: "colaborador", modulos: ["psicologia"], email: "psi@clube.com" },
  semmodulo: { role: "colaborador", modulos: [], email: "sem@clube.com" },
  naoverif: { role: "colaborador", modulos: ["fisioterapia"], email: "nv@clube.com", verificar_email: true },
};
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [uid, d] of Object.entries(U)) await setDoc(doc(db, "ct_usuarios", uid), d);
  await setDoc(doc(db, "ct_convites", "novo@clube.com"), { modulos: ["fisioterapia"] });
  await setDoc(doc(db, "ct_atletas", "a1"), { nome: "Atleta Um", categoria: "sub15", criado_por: "social" });
  await setDoc(doc(db, "ct_atletas_privado", "a1"), { cpf: "000.000.000-00" });
  await setDoc(doc(db, "ct_atletas", "a1", "ct_medicina_registros", "r1"), { tipo: "Atendimento", texto: "dados de saude" });
  await setDoc(doc(db, "ct_texto_clinico_psi", "t1"), { texto: "sigilo" });
  await setDoc(doc(db, "ct_texto_clinico_medicina", "m1"), { texto: "sigilo medico" });
  await setDoc(doc(db, "ct_avisos", "av1"), { destinatarios: ["fisio"], remetente_uid: "social", lidos: {} });
  await setDoc(doc(db, "ct_agenda_pessoal", "p1"), { uid: "treinador", titulo: "Particular" });
  await setDoc(doc(db, "ct_eventos", "j1"), { tipo: "jogo", data: "2026-12-01", criado_por: "treinador" });
  await setDoc(doc(db, "ct_eventos", "e1"), { tipo: "treino", data: "2026-12-01", criado_por: "treinador" });
  await setDoc(doc(db, "ct_checkin_links", "TOKENATIVO1234567890"), { ativo: true, atletaId: "a1" });
  await setDoc(doc(db, "ct_checkin_links", "TOKENINATIVO12345678"), { ativo: false, atletaId: "a1" });
  await setDoc(doc(db, "ct_auditoria", "x1"), { uid: "fisio", acao: "login" });
  await setDoc(doc(db, "ct_campeonatos", "c1"), { nome: "Paulista", inscritos: [] });
  await setDoc(doc(db, "ct_lembretes_enviados", "l1"), { x: 1 });
  await setDoc(doc(db, "ct_push_tokens", "tok1"), { uid: "fisio" });
});

const como = (q) => {
  if (q === "anonimo") return env.unauthenticatedContext().firestore();
  if (q === "intruso") return env.authenticatedContext("intruso", { email: "novo@clube.com", email_verified: false }).firestore();
  if (q === "naoverif") return env.authenticatedContext("naoverif", { email: "nv@clube.com", email_verified: false }).firestore();
  if (q === "verificado") return env.authenticatedContext("naoverif", { email: "nv@clube.com", email_verified: true }).firestore();
  if (q === "adminNaoVerif") return env.authenticatedContext("admin", { email: "joaovitorriaurosa2003@gmail.com", email_verified: false }).firestore();
  if (q === "intruso2") return env.authenticatedContext("intruso2", { email: "qualquer@gmail.com", email_verified: true }).firestore();
  return env.authenticatedContext(q, { email: U[q].email, email_verified: true }).firestore();
};
const casos = [];
const caso = (area, desc, quem, esperado, fn) => casos.push({ area, desc, quem, esperado, fn });
const tok = "TOKENATIVO1234567890";

// Sem login
caso("Sem login", "Ler a lista de atletas", "anonimo", "nega", (db) => getDocs(collection(db, "ct_atletas")));
caso("Sem login", "Ler CPF dos atletas", "anonimo", "nega", (db) => getDoc(doc(db, "ct_atletas_privado", "a1")));
caso("Sem login", "Listar links de check-in", "anonimo", "nega", (db) => getDocs(collection(db, "ct_checkin_links")));
caso("Sem login", "Check-in válido pelo link do atleta", "anonimo", "permite", (db) => setDoc(doc(db, "ct_checkins", tok + "_2026-11-12_pse"), { token: tok, atletaId: "a1", data: "2026-11-12", tipo: "pse", pse: 6, criado_em: serverTimestamp() }));
caso("Sem login", "Check-in com link desativado", "anonimo", "nega", (db) => setDoc(doc(db, "ct_checkins", "TOKENINATIVO12345678_2026-11-12_pse"), { token: "TOKENINATIVO12345678", atletaId: "a1", data: "2026-11-12", tipo: "pse", pse: 6, criado_em: serverTimestamp() }));
caso("Sem login", "Check-in em nome de outro atleta", "anonimo", "nega", (db) => setDoc(doc(db, "ct_checkins", tok + "_2026-11-13_pse"), { token: tok, atletaId: "a2", data: "2026-11-13", tipo: "pse", pse: 6, criado_em: serverTimestamp() }));

// Conta criada por fora (sem convite aceito / sem cadastro)
caso("Conta de fora", "Ler atletas sem ter cadastro", "intruso2", "nega", (db) => getDocs(collection(db, "ct_atletas")));
caso("Conta de fora", "Se cadastrar como admin", "intruso2", "nega", (db) => setDoc(doc(db, "ct_usuarios", "intruso2"), { role: "admin", email: "qualquer@gmail.com", modulos: [] }));
caso("Conta de fora", "Se cadastrar sem convite", "intruso2", "nega", (db) => setDoc(doc(db, "ct_usuarios", "intruso2"), { role: "colaborador", email: "qualquer@gmail.com", modulos: ["fisioterapia"] }));
caso("Conta de fora", "Usar convite e se marcar como já verificado (burlar)", "intruso", "nega", (db) => setDoc(doc(db, "ct_usuarios", "intruso"), { role: "colaborador", email: "novo@clube.com", modulos: ["fisioterapia"], verificar_email: false }));
caso("Conta de fora", "Convidado sem confirmar e-mail lê atletas", "naoverif", "nega", (db) => getDocs(collection(db, "ct_atletas")));
caso("Conta de fora", "Convidado depois de confirmar o e-mail lê atletas", "verificado", "permite", (db) => getDocs(collection(db, "ct_atletas")));
caso("Admin", "Fundador continua entrando (sem marca de verificação)", "adminNaoVerif", "permite", (db) => getDocs(collection(db, "ct_atletas")));
caso("Conta de fora", "Usar convite de outra pessoa com e-mail NÃO verificado (cadastro)", "intruso", "info", (db) => setDoc(doc(db, "ct_usuarios", "intruso"), { role: "colaborador", email: "novo@clube.com", modulos: ["fisioterapia"] }));
caso("Conta de fora", "Criar perfil público na lista da equipe", "intruso2", "nega", (db) => setDoc(doc(db, "ct_perfis", "intruso2"), { nome: "Diretor do Clube", cargo: "Diretoria" }));
caso("Conta de fora", "Gravar dado grande em ct_push_tokens (lixo/custo)", "intruso2", "nega", (db) => setDoc(doc(db, "ct_push_tokens", "lixo1"), { uid: "intruso2", lixo: "x".repeat(500000) }));

// Sem módulo
caso("Sem módulo", "Ler atletas", "semmodulo", "nega", (db) => getDocs(collection(db, "ct_atletas")));

// Fisioterapia
caso("Fisioterapia", "Ler CPF e contrato (dados restritos)", "fisio", "nega", (db) => getDoc(doc(db, "ct_atletas_privado", "a1")));
caso("Fisioterapia", "Ler texto clínico da Psicologia", "fisio", "nega", (db) => getDoc(doc(db, "ct_texto_clinico_psi", "t1")));
caso("Fisioterapia", "Ler texto clínico da Medicina", "fisio", "nega", (db) => getDoc(doc(db, "ct_texto_clinico_medicina", "m1")));
caso("Fisioterapia", "Se dar acesso de admin", "fisio", "nega", (db) => updateDoc(doc(db, "ct_usuarios", "fisio"), { role: "admin" }));
caso("Fisioterapia", "Se dar mais módulos", "fisio", "nega", (db) => updateDoc(doc(db, "ct_usuarios", "fisio"), { modulos: ["fisioterapia", "social"] }));
caso("Fisioterapia", "Ler cadastro de outro usuário", "fisio", "nega", (db) => getDoc(doc(db, "ct_usuarios", "social")));
caso("Fisioterapia", "Editar cadastro do atleta", "fisio", "nega", (db) => updateDoc(doc(db, "ct_atletas", "a1"), { categoria: "sub20" }));
caso("Fisioterapia", "Apagar atleta", "fisio", "nega", (db) => deleteDoc(doc(db, "ct_atletas", "a1")));
caso("Fisioterapia", "Criar jogo", "fisio", "nega", (db) => setDoc(doc(db, "ct_eventos", "jx"), { tipo: "jogo", data: "2026-12-02" }));
caso("Fisioterapia", "Mudar placar de jogo", "fisio", "nega", (db) => updateDoc(doc(db, "ct_eventos", "j1"), { placar_nos: 9 }));
caso("Fisioterapia", "Ler aviso enviado para ela", "fisio", "permite", (db) => getDoc(doc(db, "ct_avisos", "av1")));
caso("Fisioterapia", "Mandar aviso em nome de outra pessoa", "fisio", "nega", (db) => setDoc(doc(db, "ct_avisos", "avx"), { remetente_uid: "social", destinatarios: ["treinador"], nivel: "informativo", titulo: "x", mensagem: "x", lidos: {} }));
caso("Fisioterapia", "Ler a agenda particular do treinador", "fisio", "nega", (db) => getDoc(doc(db, "ct_agenda_pessoal", "p1")));
caso("Fisioterapia", "Se marcar como admin no diretório", "fisio", "nega", (db) => setDoc(doc(db, "ct_diretorio", "fisio"), { admin: true, diretoria: false, modulos: ["fisioterapia"] }));
caso("Fisioterapia", "Apagar registro de acesso (auditoria)", "fisio", "nega", (db) => deleteDoc(doc(db, "ct_auditoria", "x1")));
caso("Fisioterapia", "Ler aparelhos de notificação", "fisio", "nega", (db) => getDoc(doc(db, "ct_push_tokens", "tok1")));
caso("Fisioterapia", "Ler controle do robô de lembretes", "fisio", "nega", (db) => getDoc(doc(db, "ct_lembretes_enviados", "l1")));

// Nutrição
caso("Nutrição", "Ler aviso que não é para ela", "nutri", "nega", (db) => getDoc(doc(db, "ct_avisos", "av1")));
caso("Nutrição", "Ler registros da Medicina (dados de saúde)", "nutri", "a confirmar", (db) => getDoc(doc(db, "ct_atletas", "a1", "ct_medicina_registros", "r1")));
caso("Nutrição", "Lançar carga de treino num jogo", "nutri", "permite", (db) => updateDoc(doc(db, "ct_eventos", "j1"), { cargas: { a1: 300 }, atualizado_em: 1 }));

// Diretoria, Social, Psicologia, Treinador
caso("Diretoria", "Ler CPF e contrato", "diretoria", "permite", (db) => getDoc(doc(db, "ct_atletas_privado", "a1")));
caso("Diretoria", "Ler texto clínico da Psicologia", "diretoria", "nega", (db) => getDoc(doc(db, "ct_texto_clinico_psi", "t1")));
caso("Serviço Social", "Ler CPF e contrato", "social", "permite", (db) => getDoc(doc(db, "ct_atletas_privado", "a1")));
caso("Psicologia", "Ler texto clínico da Psicologia", "psi", "permite", (db) => getDoc(doc(db, "ct_texto_clinico_psi", "t1")));
caso("Psicologia", "Ler CPF e contrato", "psi", "nega", (db) => getDoc(doc(db, "ct_atletas_privado", "a1")));
caso("Treinador", "Criar campeonato", "treinador", "permite", (db) => setDoc(doc(db, "ct_campeonatos", "c2"), { nome: "Copa", inscritos: [], criado_por: "treinador" }));
caso("Treinador", "Ler campeonatos", "treinador", "permite", (db) => getDoc(doc(db, "ct_campeonatos", "c1")));
caso("Fisioterapia", "Criar campeonato", "fisio", "nega", (db) => setDoc(doc(db, "ct_campeonatos", "c3"), { nome: "Copa", inscritos: [] }));
caso("Admin", "Ler auditoria", "admin", "permite", (db) => getDocs(collection(db, "ct_auditoria")));

const res = [];
for (const c of casos) {
  let ok;
  try { await c.fn(como(c.quem)); ok = "permite"; } catch (e) { ok = /PERMISSION_DENIED|permission/i.test(String(e.code || e.message)) ? "nega" : "erro: " + (e.code || e.message).slice(0, 60); }
  const passou = (c.esperado === "a confirmar" || c.esperado === "info") ? null : ok === c.esperado;
  res.push({ ...c, fn: undefined, obtido: ok, passou });
}
await env.cleanup();
const linhas = res.map((r) => `${r.passou === null ? "??" : r.passou ? "OK" : "XX"} | ${r.area} | ${r.desc} | esperado ${r.esperado} | ${r.obtido}`);
console.log(linhas.join("\n"));
console.log(`\n${res.filter((r) => r.passou).length} ok, ${res.filter((r) => r.passou === false).length} falhas, ${res.filter((r) => r.passou === null).length} a confirmar`);
writeFileSync(arq + ".resultado.json", JSON.stringify(res, null, 1));
process.exit(0);
