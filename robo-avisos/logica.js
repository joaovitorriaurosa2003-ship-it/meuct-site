// Logica do robo de avisos do MeuCT: decide o que precisa ser enviado agora.
// Sem acesso ao banco aqui, para poder ser testado com dados de exemplo.

const FUSO = "America/Sao_Paulo";
const JANELA_LEMBRETE_MIN = 180; // lembrete atrasado ate 3 h ainda e enviado; mais que isso, fica so no app
const HORA_RE = /^\d\d:\d\d$/;

/** Data (AAAA-MM-DD) e hora (HH:MM) no horario de Brasilia. */
function agoraBrasil(data) {
  const p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(data || new Date()).forEach((x) => { p[x.type] = x.value; });
  return { hoje: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

function minutos(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }

function horasValidas(c) {
  return Array.isArray(c && c.lembrete_horas)
    ? Array.from(new Set(c.lembrete_horas.filter((h) => typeof h === "string" && HORA_RE.test(h)))).sort().slice(0, 6)
    : [];
}

/** Mesma regra do app: lembra todo dia a partir da data do compromisso ate "lembrar ate" (vazio = sem fim). */
function lembreteAtivoEm(c, dia) {
  if (!c || !c.data || !horasValidas(c).length) return false;
  return dia >= c.data && (!c.lembrete_ate || dia <= c.lembrete_ate);
}

function tituloEvento(e) {
  if (e.titulo && String(e.titulo).trim()) return String(e.titulo).trim();
  if (e.tipo === "jogo") return "Meia Noite x " + ((e.adversario || "").trim() || "adversário a definir");
  const nomes = { jogo: "Jogo", treino: "Treino", avaliacao: "Avaliação", atendimento: "Atendimento", reuniao: "Reunião", compromisso: "Compromisso", palestra: "Palestra" };
  return nomes[e.tipo] || "Outro";
}

function formatarData(iso) { const [a, m, d] = String(iso || "").split("-"); return d && m && a ? `${d}/${m}/${a}` : ""; }
function textoPeriodo(c) { return c.data_fim && c.data_fim > c.data ? "de " + formatarData(c.data).slice(0, 5) + " a " + formatarData(c.data_fim) : ""; }
function corta(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }

/**
 * Lembretes que vencem agora.
 * eventos: docs de ct_eventos ({id, ...}); pessoais: docs de ct_agenda_pessoal ({id, uid, ...});
 * equipe: uids de quem e da equipe (eventos da agenda vao para toda a equipe, como no app).
 * Devolve [{ chave, uids, titulo, corpo, tag, abrir }].
 */
function planejarLembretes({ hoje, hhmm, eventos, pessoais, equipe, janela }) {
  const lim = janela === undefined ? JANELA_LEMBRETE_MIN : janela;
  const agoraMin = minutos(hhmm);
  const fontes = [
    ...(pessoais || []).filter((c) => c.uid).map((c) => ({
      id: "p-" + c.id, c, uids: [c.uid], abrir: "minha_agenda",
      titulo: c.titulo || "Compromisso",
      detalhe: [c.dia_todo ? "" : c.inicio, c.local, c.obs].filter(Boolean).join(" · "),
    })),
    ...(eventos || []).filter((e) => !e.qts).map((e) => ({
      id: "e-" + e.id, c: e, uids: equipe || [], abrir: "agenda",
      titulo: tituloEvento(e),
      detalhe: [e.hora, e.local, e.observacao].filter(Boolean).join(" · "),
    })),
  ];
  const saida = [];
  fontes.forEach((f) => {
    if (!f.uids.length || !lembreteAtivoEm(f.c, hoje)) return;
    const vencidas = horasValidas(f.c).filter((h) => minutos(h) <= agoraMin && agoraMin - minutos(h) <= lim);
    if (!vencidas.length) return;
    const h = vencidas[vencidas.length - 1]; // se perdeu mais de um horario, manda so o ultimo
    const periodo = textoPeriodo(f.c);
    saida.push({
      chave: `${f.id}_${hoje}_${h.replace(":", "")}`,
      horasCobertas: vencidas.map((x) => `${f.id}_${hoje}_${x.replace(":", "")}`),
      uids: Array.from(new Set(f.uids)),
      titulo: "Lembrete · " + h,
      corpo: corta([f.titulo, f.detalhe, periodo].filter(Boolean).join(" · "), 230),
      tag: "lemb-" + f.id,
      abrir: f.abrir,
    });
  });
  return saida;
}

/* ---------- Lembrete diario dos jogos (sempre, sem precisar marcar) ---------- */
const HORA_JOGOS = "08:00";
const DIAS_ANTES_JOGO = 7;
const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function diasEntre(de, ate) { return Math.round((Date.parse(ate + "T12:00:00Z") - Date.parse(de + "T12:00:00Z")) / 86400000); }
function labelCategoria(id) { const m = String(id || "").match(/^sub(\d+)$/i); return m ? "Sub-" + m[1] : id === "ambas" ? "Todas as categorias" : ""; }
function nomeAtleta(a) { return a ? ((a.apelido || "").trim() || a.nome || "") : ""; }

/** Suspensos e pendurados para um jogo do campeonato (mesma regra do app: X amarelos ou um vermelho). */
function cartoesParaJogo(c, jogosAntes) {
  const limite = Math.max(1, Number(c.amarelos_suspensao) || 3);
  const st = {};
  const de = (id) => st[id] || (st[id] = { id, ciclo: 0, suspensoApos: null });
  jogosAntes.forEach((e, k) => {
    Object.values(st).forEach((s) => { if (s.suspensoApos !== null && s.suspensoApos < k) s.suspensoApos = null; });
    if (!e.pos_jogo) return;
    Object.entries(e.pos_jogo.atletas || {}).forEach(([id, reg]) => {
      const ca = Number(reg && reg.ca) || 0, cv = Number(reg && reg.cv) || 0;
      if (!ca && !cv) return;
      const s = de(id);
      if (cv) { s.suspensoApos = k; s.ciclo = 0; return; }
      s.ciclo += ca;
      if (s.ciclo >= limite) { s.suspensoApos = k; s.ciclo = 0; }
    });
  });
  const todos = Object.values(st);
  return { suspensos: todos.filter((s) => s.suspensoApos !== null).map((s) => s.id), pendurados: todos.filter((s) => s.suspensoApos === null && s.ciclo === limite - 1 && limite > 1).map((s) => s.id) };
}

/** O que falta acertar no jogo (mesma lista do app). */
function pendenciasJogo(e, campeonatos, eventos, atletasPorId) {
  const p = [];
  const conv = e.convocacao || {};
  if (!((conv.titulares || []).length + (conv.reservas || []).length)) p.push("convocação não feita");
  if (!e.hora) p.push("horário em aberto");
  if (!String(e.local || "").trim()) p.push("local em aberto");
  if (!(conv.comissao || []).length) p.push("comissão do jogo não escolhida");
  const c = e.campeonato_id && (campeonatos || []).find((x) => x.id === e.campeonato_id);
  if (c) {
    const chave = (j) => (j.data || "") + (j.hora || "");
    const antes = (eventos || []).filter((j) => j.tipo === "jogo" && j.campeonato_id === c.id && chave(j) < chave(e)).sort((a, b) => chave(a).localeCompare(chave(b)));
    const st = cartoesParaJogo(c, antes);
    const nomes = (ids) => ids.map((id) => nomeAtleta((atletasPorId || {})[id])).filter(Boolean).join(", ");
    if (st.suspensos.length) p.push(st.suspensos.length + (st.suspensos.length > 1 ? " suspensos" : " suspenso") + (nomes(st.suspensos) ? " (" + nomes(st.suspensos) + ")" : ""));
    if (st.pendurados.length) p.push(st.pendurados.length + (st.pendurados.length > 1 ? " pendurados" : " pendurado") + (nomes(st.pendurados) ? " (" + nomes(st.pendurados) + ")" : ""));
  }
  return p;
}

/**
 * Jogos dos proximos 7 dias: um lembrete por jogo por dia, as 8h, para a comissao tecnica e o admin.
 * Devolve no mesmo formato de planejarLembretes.
 */
function planejarJogos({ hoje, hhmm, eventos, campeonatos, atletasPorId, comissao, janela }) {
  const lim = janela === undefined ? JANELA_LEMBRETE_MIN : janela;
  const agoraMin = minutos(hhmm), h = minutos(HORA_JOGOS);
  if (!comissao || !comissao.length || agoraMin < h || agoraMin - h > lim) return [];
  return (eventos || [])
    .filter((e) => e.tipo === "jogo" && e.data && !e.cancelado && diasEntre(hoje, e.data) >= 0 && diasEntre(hoje, e.data) <= DIAS_ANTES_JOGO)
    .sort((a, b) => ((a.data || "") + (a.hora || "")).localeCompare((b.data || "") + (b.hora || "")))
    .map((e) => {
      const n = diasEntre(hoje, e.data);
      const quando = n === 0 ? "Hoje tem jogo" : n === 1 ? "Amanhã tem jogo" : "Faltam " + n + " dias";
      const d = new Date(e.data + "T12:00:00Z");
      const info = [DIA_SEMANA[d.getUTCDay()] + " " + formatarData(e.data).slice(0, 5), e.hora, String(e.local || "").trim(), labelCategoria(e.categoria)].filter(Boolean).join(" · ");
      const pend = pendenciasJogo(e, campeonatos, eventos, atletasPorId);
      const chave = `j-${e.id}_${hoje}`;
      return {
        chave, horasCobertas: [chave], uids: Array.from(new Set(comissao)),
        titulo: corta(quando + " · " + tituloEvento(e), 110),
        corpo: corta(info + (pend.length ? ". Pendente: " + pend.join("; ") + "." : ". Tudo certo para o jogo."), 230),
        tag: "jogo-" + e.id, abrir: "jogos",
      };
    });
}

/** Quem recebe o lembrete dos jogos: admin e comissao tecnica (treinador, desempenho, preparacao fisica). */
function ehComissao(u) { return !!u && (u.role === "admin" || (Array.isArray(u.modulos) && u.modulos.some((m) => ["treinador", "desempenho", "preparacao"].includes(m)))); }

/** Aviso da equipe ainda sem notificacao enviada (e sem outra rodada cuidando dele). */
function avisoPendente(a, agoraMs, reservaMin) {
  if (!a || a.push_enviado_em) return false;
  if (!Array.isArray(a.destinatarios) || !a.destinatarios.length) return false;
  const r = a.push_reservado_em;
  const rMs = r && typeof r.toMillis === "function" ? r.toMillis() : (typeof r === "number" ? r : null);
  return !rMs || agoraMs - rMs > (reservaMin || 15) * 60000;
}

function mensagemDoAviso(a) {
  return {
    uids: Array.from(new Set(a.destinatarios.filter((u) => u && u !== a.remetente_uid))),
    titulo: corta((a.nivel === "urgente" ? "Urgente: " : "") + (a.titulo || "Novo aviso"), 110),
    corpo: corta([a.remetente_nome ? a.remetente_nome + ":" : "", a.mensagem || ""].filter(Boolean).join(" "), 230),
    tag: "aviso-" + a.id,
    abrir: "avisos",
  };
}

/** Quem conta como equipe (mesma regra do app: administrador ou com algum modulo). */
function ehEquipe(u) { return !!u && (u.role === "admin" || (Array.isArray(u.modulos) && u.modulos.length > 0)); }

module.exports = { agoraBrasil, planejarLembretes, planejarJogos, pendenciasJogo, ehComissao, avisoPendente, mensagemDoAviso, ehEquipe, lembreteAtivoEm, horasValidas, minutos, diasEntre };
