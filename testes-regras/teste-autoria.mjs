// Autoria: quem edita nao pode virar autor do item de outra pessoa para depois apagar.
// Uso: firebase emulators:exec --only firestore "node teste-autoria.mjs firestore.rules"
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
const env = await initializeTestEnvironment({ projectId: "meuct-sonda", firestore: { rules: readFileSync(process.argv[2] || "firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "ct_usuarios", "treinador"), { role: "colaborador", modulos: ["treinador"], email: "tec@clube.com" });
  await setDoc(doc(db, "ct_usuarios", "medico"), { role: "colaborador", modulos: ["medicina"], email: "med@clube.com" });
  await setDoc(doc(db, "ct_usuarios", "fisio"), { role: "colaborador", modulos: ["fisioterapia"], email: "f@clube.com" });
  await setDoc(doc(db, "ct_atletas", "a1"), { nome: "Atleta", criado_por: "social" });
  await setDoc(doc(db, "ct_atletas", "a1", "ct_medicina_registros", "r1"), { texto: "x", criado_por: "outro" });
  await setDoc(doc(db, "ct_eventos", "e1"), { tipo: "treino", criado_por: "outro" });
});
const como = (u, e) => env.authenticatedContext(u, { email: e, email_verified: true }).firestore();
const r = async (desc, p) => { try { await p; console.log("PERMITIU |", desc); } catch (e) { console.log("negou    |", desc); } };
const t = como("treinador", "tec@clube.com");
await r("Treinador apaga atleta direto", deleteDoc(doc(t, "ct_atletas", "a1")));
await r("Treinador troca criado_por do atleta para si", updateDoc(doc(t, "ct_atletas", "a1"), { criado_por: "treinador" }));
await r("Treinador apaga o atleta depois", deleteDoc(doc(t, "ct_atletas", "a1")));
const m = como("medico", "med@clube.com");
await r("Medicina troca criado_por de registro de outro", updateDoc(doc(m, "ct_atletas", "a1", "ct_medicina_registros", "r1"), { criado_por: "medico" }));
await r("Medicina apaga o registro depois", deleteDoc(doc(m, "ct_atletas", "a1", "ct_medicina_registros", "r1")));
const f = como("fisio", "f@clube.com");
await r("Fisio troca criado_por de evento de outro", updateDoc(doc(f, "ct_eventos", "e1"), { criado_por: "fisio" }));
await r("Fisio apaga o evento depois", deleteDoc(doc(f, "ct_eventos", "e1")));
// casos legítimos e QTS pessoal
await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore();
  await setDoc(doc(db, "ct_atletas", "a2"), { nome: "Dois", criado_por: "social" });
  await setDoc(doc(db, "ct_eventos", "e2"), { tipo: "treino", criado_por: "outro", titulo: "x" });
  await setDoc(doc(db, "ct_eventos", "e3"), { tipo: "treino", criado_por: "fisio", titulo: "meu" });
  await setDoc(doc(db, "ct_usuarios", "outro"), { role: "colaborador", modulos: ["fisioterapia"], email: "o@clube.com" });
  await setDoc(doc(db, "ct_qts_pessoal", "q1"), { uid: "outro", grade: {} });
  await setDoc(doc(db, "ct_qts_pessoal", "q2"), { uid: "fisio", grade: {} });
});
await r("[ok esperado] Treinador edita nome do atleta mantendo o autor", updateDoc(doc(t, "ct_atletas", "a2"), { nome: "Dois B" }));
await r("[ok esperado] Treinador cria atleta novo com ele de autor", setDoc(doc(t, "ct_atletas", "a3"), { nome: "Tres", criado_por: "treinador" }));
await r("[ok esperado] Fisio edita evento de outro mantendo o autor", updateDoc(doc(f, "ct_eventos", "e2"), { titulo: "y" }));
await r("[ok esperado] Fisio apaga o próprio evento", deleteDoc(doc(f, "ct_eventos", "e3")));
await r("[ok esperado] Treinador lê atletas", (await import("firebase/firestore")).getDoc(doc(t, "ct_atletas", "a2")));
await r("Fisio toma o QTS pessoal de outra pessoa", setDoc(doc(f, "ct_qts_pessoal", "q1"), { uid: "fisio", grade: {} }));
await r("Fisio apaga o QTS de outra pessoa", deleteDoc(doc(f, "ct_qts_pessoal", "q1")));
await r("[ok esperado] Fisio edita o próprio QTS", updateDoc(doc(f, "ct_qts_pessoal", "q2"), { grade: { seg: 1 } }));
await env.cleanup();
