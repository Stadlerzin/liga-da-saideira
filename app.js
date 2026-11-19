import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence, connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, query, orderBy, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  increment, arrayUnion, arrayRemove, serverTimestamp, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

/* ---------- Regras do jogo ---------- */
const TYPES = {
  bar:   { label: "Bar",   pts: 5,  cls: "t-bar" },
  festa: { label: "Festa", pts: 10, cls: "t-festa" },
};
const DRINKS = [
  { k: "cerveja",   label: "Cerveja",           pts: 1, one: "cerveja",   many: "cervejas" },
  { k: "destilado", label: "Copo de destilado", pts: 2, one: "destilado", many: "destilados" },
  { k: "shot",      label: "Shot",              pts: 3, one: "shot",      many: "shots" },
];
const RESENHA = [
  { k: "beijos", label: "Beijo",  pts: 3, one: "beijo",  many: "beijos" },
  { k: "tocos",  label: "Toco",   pts: 1, one: "toco",   many: "tocos" },
  { k: "transa", label: "Transa", pts: 8, one: "transa", many: "transas" },
];
const ALL = [...DRINKS, ...RESENHA];
const PT_PTS = -5;
const COLORS = ["#ff3ccf","#2ee6ff","#b45cff","#7cf7d4","#ff8a3c","#fff04d","#ff5c8a","#5c8aff"];
const VIRADA = new Date(2027, 0, 1, 0, 0, 0);
const PHONE_DOMAIN = "tel.ligadasaideira.app";

/* ---------- Estado ---------- */
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("COLE");
const app = configured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
if (app && firebaseConfig.useEmulator){ connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8080); }

const S = {
  authReady: false, me: null, member: null,
  users: {}, checkins: [], loaded: false, err: null,
  draft: freshDraft(), authMode: "entrar", photos: {},
};
const openQuick = new Set();
let unsubs = [];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => Math.max(0, Math.floor(+v || 0));
function freshDraft(){ return { type: "bar", place: "", when: localInput(new Date()), n: {}, pt: false, note: "", photoData: "", editId: null, photoId: null }; }
function localInput(d){ const p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

/* ---------- Login (e-mail ou telefone) ---------- */
function toLoginEmail(raw){
  const v = raw.trim();
  if (v.includes("@")) return { email: v.toLowerCase(), isPhone: false };
  let digits = v.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits; // DDD + número
  if (digits.length < 12) return null;
  return { email: `${digits}@${PHONE_DOMAIN}`, isPhone: true };
}
function authError(e){
  const c = e && e.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "E-mail/telefone ou senha errados.";
  if (c.includes("email-already-in-use")) return "Já existe uma conta com esse e-mail ou telefone. Tente entrar.";
  if (c.includes("weak-password")) return "A senha precisa ter pelo menos 6 caracteres.";
  if (c.includes("invalid-email")) return "Esse e-mail não parece válido.";
  if (c.includes("too-many-requests")) return "Muitas tentativas. Espere um pouco e tente de novo.";
  if (c.includes("network")) return "Sem conexão. Confira sua internet.";
  return "Não deu certo. Tente de novo.";
}

/* ---------- Pontuação ---------- */
function ciCalc(c){
  const n = c.n || {};
  const base = TYPES[c.type]?.pts || 0;
  const doses = DRINKS.reduce((a,d) => a + num(n[d.k]), 0);
  const extra = ALL.reduce((a,d) => a + num(n[d.k]) * d.pts, 0);
  return { doses, total: base + extra + (c.pt ? PT_PTS : 0), beijos: num(n.beijos), tocos: num(n.tocos), transa: num(n.transa) };
}
function weekStart(){ const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (d.getDay()+6)%7); return d.getTime(); }
function playerStats(uid, since = 0){
  const cs = S.checkins.filter(c => c.uid === uid && c.ts >= since);
  const st = { V: cs.length, P: 0, doses: 0, beijos: 0, tocos: 0, transa: 0, pt: 0, bar: 0, festa: 0, cerveja: 0, destilado: 0, shot: 0 };
  for (const c of cs){ const r = ciCalc(c); st.P += r.total; st.doses += r.doses; st.beijos += r.beijos; st.tocos += r.tocos; st.transa += r.transa;
    if (c.pt) st.pt++; if (c.type === "bar") st.bar++; else st.festa++;
    for (const d of DRINKS) st[d.k] += num(c.n?.[d.k]); }
  st.SG = st.beijos - st.tocos;
  return st;
}
function standings(since = 0){
  const ids = new Set([...Object.keys(S.users), ...S.checkins.map(c => c.uid)]);
  const rows = [...ids].map(id => ({ id, ...playerStats(id, since) }));
  rows.sort((a,b) => b.P-a.P || b.V-a.V || b.SG-a.SG || nameOf(a.id).localeCompare(nameOf(b.id),"pt-BR"));
  return rows;
}

/* ---------- Pessoas ---------- */
function nameOf(id){ return S.users[id]?.nick || "Jogador"; }
function colorOf(id){ let h=0; for (const ch of String(id)) h = (h*31 + ch.charCodeAt(0))>>>0; return COLORS[h % COLORS.length]; }
function avatar(id){ return `<span class="avatar" style="background:${colorOf(id)}" aria-hidden="true">${esc(nameOf(id).trim().charAt(0).toUpperCase() || "?")}</span>`; }

/* ---------- Tempo ---------- */
function ago(ts){
  const s = Math.round((Date.now()-ts)/1000);
  if (s < 0) return new Date(ts).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s/60)} min`;
  if (s < 86400) return `há ${Math.floor(s/3600)} h`;
  if (s < 7*86400) return `há ${Math.floor(s/86400)} d`;
  return new Date(ts).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"});
}
function tickCountdown(){
  const ms = VIRADA - Date.now();
  if (ms <= 0){ $("#days").textContent = "2027"; $("#daysLbl").textContent = "feliz ano novo"; return; }
  const d = Math.floor(ms/86400000);
  if (d >= 1){ $("#days").textContent = d; $("#daysLbl").textContent = (d===1?"dia":"dias")+" p/ virada"; }
  else { const h = Math.floor(ms/3600000), m = Math.floor(ms%3600000/60000); $("#days").textContent = `${h}h${String(m).padStart(2,"0")}`; $("#daysLbl").textContent = "p/ virada"; }
}

/* ---------- Fotos (guardadas comprimidas no Firestore) ---------- */
function shrinkToDataUrl(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let max = 1080, q = 0.72, out = "";
      for (let i = 0; i < 5; i++){
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", q);
        if (out.length < 700000) return res(out);
        max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
      }
      out.length < 900000 ? res(out) : rej(new Error("grande"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
    img.src = url;
  });
}
function photoSrc(id){
  if (!id) return "";
  const v = S.photos[id];
  if (v === undefined){
    S.photos[id] = null;
    getDoc(doc(db, "photos", id)).then(snap => { S.photos[id] = snap.exists() ? snap.data().data : ""; render(); }).catch(() => { S.photos[id] = ""; });
    return "";
  }
  return v || "";
}

/* ---------- Telas ---------- */
function statusBanner(){
  if (S.err) return `<div class="banner warn"><strong>Ops.</strong> ${esc(S.err)}</div>`;
  if (S.me && S.member && !S.loaded) return `<div class="banner">Carregando…</div>`;
  return "";
}

function viewAuth(){
  const signup = S.authMode === "criar";
  return `<div class="authbox">
    <p class="sub" style="margin-bottom:16px">${signup ? "Crie sua conta para entrar na liga." : "Entre para ver a tabela e postar seus rolês."}</p>
    <div class="seg" role="group" aria-label="Entrar ou criar conta" style="width:100%;display:grid;grid-template-columns:1fr 1fr">
      <button type="button" data-authmode="entrar" aria-pressed="${!signup}">Entrar</button>
      <button type="button" data-authmode="criar" aria-pressed="${signup}">Criar conta</button>
    </div>
    <form id="authForm" class="ci" novalidate>
      ${signup ? `<div><label class="lbl" for="aNick">Apelido na tabela</label><input class="field" id="aNick" maxlength="24" autocomplete="nickname" required></div>` : ""}
      <div><label class="lbl" for="aLogin">E-mail ou celular</label><input class="field" id="aLogin" autocomplete="username" inputmode="email" placeholder="voce@email.com ou (11) 91234-5678" required></div>
      <div><label class="lbl" for="aPass">Senha</label><input class="field" id="aPass" type="password" minlength="6" autocomplete="${signup ? "new-password" : "current-password"}" required></div>
      ${signup ? `<div><label class="lbl" for="aCode">Código da liga</label><input class="field" id="aCode" autocomplete="off" autocapitalize="characters" placeholder="Peça para quem te convidou" required></div>` : ""}
      <button class="btn primary" type="submit" id="authSubmit">${signup ? "Criar conta" : "Entrar"}</button>
      <div id="authMsg" class="msg" role="status"></div>
      ${signup ? "" : `<button type="button" class="btn ghost" id="forgot" style="align-self:flex-start;padding-left:0">Esqueci a senha</button>`}
    </form>
  </div>`;
}

function viewJoin(){
  return `<div class="authbox"><p class="sub">Falta só escolher seu apelido e colocar o código da liga.</p>
    <form id="joinForm" class="ci" novalidate>
      <div><label class="lbl" for="jNick">Apelido na tabela</label><input class="field" id="jNick" maxlength="24" required></div>
      <div><label class="lbl" for="jCode">Código da liga</label><input class="field" id="jCode" autocapitalize="characters" required></div>
      <button class="btn primary" type="submit">Entrar na liga</button>
      <div id="joinMsg" class="msg ${S.joinErr?"err":""}" role="status">${esc(S.joinErr||"")}</div>
      <button type="button" class="btn ghost" data-logout style="align-self:flex-start;padding-left:0">Sair</button>
    </form></div>`;
}

function viewTabela(){
  const rows = standings(0);
  const n = rows.length;
  const zone = i => { if (i===0 && n>=2) return "z-lider"; if (n>=6 && i<4) return "z-g4"; if (n>=3 && i===n-1) return "z-z4"; return ""; };
  if (!n) return `<div class="empty"><b>Tabela vazia</b>O primeiro check-in abre o campeonato.<br><br><a class="btn primary" href="#checkin" style="text-decoration:none;display:inline-block">Postar</a></div>`;
  return `<div class="tablebox"><table class="liga clean">
    <thead><tr><th>#</th><th class="l">Jogador</th><th title="Pontos">P</th><th title="Vitórias: saídas">V</th><th title="Saldo: beijos menos tocos">SG</th></tr></thead><tbody>
    ${rows.map((r,i) => `<tr class="${zone(i)} ${r.id===S.me?"me":""}">
      <td class="pos">${i+1}</td>
      <td class="l name">${avatar(r.id)}${esc(nameOf(r.id))}</td>
      <td class="pts">${r.P}</td><td>${r.V}</td><td>${r.SG>0?"+":""}${r.SG}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

function countText(c, list){ return list.filter(x => num(c.n?.[x.k]) > 0).map(x => `${num(c.n[x.k])} ${num(c.n[x.k]) === 1 ? x.one : x.many}`).join(" · "); }
function viewFeed(){
  const list = S.checkins.slice(0, 60);
  if (!list.length) return `<div class="empty"><b>Nenhum rolê ainda</b>Os check-ins da galera aparecem aqui.</div>`;
  return `<div class="feed">${list.map(c => {
    const r = ciCalc(c), t = TYPES[c.type] || TYPES.festa, kudos = c.kudos || [], k = kudos.length, own = c.uid === S.me, on = kudos.includes(S.me);
    const summary = [countText(c, DRINKS), countText(c, RESENHA), c.pt ? "PT" : ""].filter(Boolean).join(" · ");
    const src = photoSrc(c.photoId), live = own && Date.now()-c.ts < 14*3600000;
    return `<article class="post clean">
      <div class="post-h">${avatar(c.uid)}<div class="who-w"><div class="who">${esc(nameOf(c.uid))}</div><div class="when">${esc(c.place || t.label)} · ${ago(c.ts)}</div></div><b class="score ${r.total<0?"neg":t.cls}">${r.total>=0?"+":""}${r.total}</b></div>
      ${c.photoId?`<div class="photo">${src?`<img src="${src}" alt="Foto do rolê de ${esc(nameOf(c.uid))}">`:""}</div>`:""}
      ${summary?`<div class="drinklist">${esc(summary)}</div>`:""}
      ${c.note?`<p class="note">${esc(c.note)}</p>`:""}
      ${live && openQuick.has(c.id) ? `<div class="qbtns">${ALL.map(x => `<button class="btn" data-quick="${x.k}" data-cid="${esc(c.id)}">+ ${x.label}</button>`).join("")}<button class="btn ${c.pt?"on":""}" data-quickpt="${esc(c.id)}">${c.pt?"Desfazer PT":"Dei PT"}</button></div>` : ""}
      <div class="post-f">
        ${!own ? `<button class="btn ${on?"on":""}" data-kudo="${esc(c.id)}" aria-pressed="${on}">Brindar${k?` · ${k}`:""}</button>` : `<span class="kc">${k?`${k} ${k===1?"brinde":"brindes"}`:""}</span>`}
        ${live?`<button class="btn" data-togglequick="${esc(c.id)}" aria-expanded="${openQuick.has(c.id)}">${openQuick.has(c.id)?"Fechar":"+ Somar"}</button>`:""}
        ${own?`<button class="btn ghost" data-edit="${esc(c.id)}">Editar</button>`:""}
      </div>
    </article>`; }).join("")}</div>`;
}

function stepper(x, q){
  return `<div class="stp ${q?"has":""}">
    <div class="nm">${x.label} <span class="abv">${x.pts>0?"+":""}${x.pts}</span></div>
    <div class="ctl"><button type="button" data-step="${x.k}" data-d="-1" aria-label="Menos ${x.label}">−</button><b>${q}</b><button type="button" data-step="${x.k}" data-d="1" aria-label="Mais ${x.label}">+</button></div>
  </div>`;
}
function viewCheckin(){
  const d = S.draft;
  const prev = ciCalc({ type: d.type, n: d.n, pt: d.pt });
  const shown = d.photoData || (d.photoId ? photoSrc(d.photoId) : "");
  return `<form class="ci" id="ciForm" novalidate>
    ${d.editId?`<div class="editbar"><span class="eyebrow">Editando rolê</span><button type="button" class="btn ghost" id="cancelEdit">Cancelar</button></div>`:""}
    <label class="drop" for="photo">${shown?`<img src="${shown}" alt="Prévia da foto">`:`<b>+ Foto</b><span>obrigatória</span>`}<input type="file" id="photo" accept="image/*"></label>
    <div class="typepick" style="grid-template-columns:repeat(2,1fr)">
      ${Object.entries(TYPES).map(([k,t]) => `<label class="${t.cls}"><input type="radio" name="type" id="type-${k}" value="${k}" ${d.type===k?"checked":""}><b>${t.label}</b><small>${t.pts} pts</small></label>`).join("")}
    </div>
    <input class="field" id="place" maxlength="60" placeholder="Onde?" aria-label="Onde" value="${esc(d.place)}">
    <div class="steppers">${ALL.map(x => stepper(x, num(d.n[x.k]))).join("")}</div>
    <div class="checks"><label><input type="checkbox" id="pt" ${d.pt?"checked":""}> Dei PT (−5)</label></div>
    <details class="more" ${d.note||d.editId?"open":""}><summary>Mais opções</summary>
      <label class="lbl" for="when">Data</label><input class="field" id="when" type="datetime-local" value="${esc(d.when)}">
      <label class="lbl" for="note" style="margin-top:12px">Resenha</label><textarea class="field" id="note" maxlength="280" placeholder="Como foi a noite?">${esc(d.note)}</textarea>
      ${d.editId?`<button type="button" class="btn ghost danger" data-del="${esc(d.editId)}">Apagar rolê</button>`:""}
    </details>
    <div class="preview">
      <b id="pvTotal" class="${prev.total<0?"neg":TYPES[d.type].cls}">${prev.total>=0?"+":""}${prev.total}</b><small class="eyebrow">pts</small>
      <button class="btn primary" type="submit" id="ciSubmit">${d.editId?"Salvar":"Postar"}</button>
      <div id="ciMsg" class="msg" role="status"></div>
    </div>
  </form>`;
}

function viewDesafios(){
  const rows = standings(0).filter(r => r.V > 0);
  const lead = fn => rows.map(r => ({ r, v: fn(r) })).filter(x => x.v > 0).sort((a,b) => b.v - a.v)[0];
  const card = (title, x, unit) => `<div class="ch clean"><span class="eyebrow">${title}</span>
    ${x ? `<div class="lead">${avatar(x.r.id)}${esc(nameOf(x.r.id))}<b>${x.v}${unit}</b></div>` : `<div class="lead" style="color:var(--muted)">Ninguém ainda</div>`}</div>`;
  const wk = standings(weekStart()).filter(r => r.P > 0)[0];
  return `<div class="chal">
    ${card("Craque da semana", wk ? { r: wk, v: wk.P } : null, " pts")}
    ${card("Maratonista", lead(r=>r.V), "")}
    ${card("Pegador", lead(r=>r.beijos), "")}
    ${card("Rei do toco", lead(r=>r.tocos), "")}
    ${card("Cervejeiro", lead(r=>r.cerveja), "")}
    ${card("Clube do PT", lead(r=>r.pt), "")}
  </div>`;
}

function viewPerfil(){
  const u = S.users[S.me] || {};
  const st = playerStats(S.me);
  const pos = standings(0).findIndex(r => r.id === S.me) + 1;
  const login = auth.currentUser?.email || "";
  const shownLogin = login.endsWith("@" + PHONE_DOMAIN) ? "+" + login.split("@")[0] : login;
  return `<div class="join"><input class="field" id="nick" maxlength="24" aria-label="Apelido na tabela" value="${esc(u.nick||"")}"><button class="btn primary" id="saveNick" type="button">Salvar</button></div><div id="nickMsg" class="msg" role="status"></div>
  <div class="big">
    <div><b>${pos?pos+"º":"–"}</b><small>posição</small></div>
    <div><b class="t-open">${st.P}</b><small>pontos</small></div>
    <div><b>${st.V}</b><small>saídas</small></div>
    <div><b>${st.SG>0?"+":""}${st.SG}</b><small>saldo</small></div>
  </div>
  <details class="more"><summary>Como pontua</summary>
    <ul class="rulelist">
      <li><span>Bar</span><b>5</b></li><li><span>Festa</span><b>10</b></li>
      <li><span>Cerveja</span><b>1</b></li><li><span>Copo de destilado</span><b>2</b></li><li><span>Shot</span><b>3</b></li>
      <li><span>Beijo</span><b>3</b></li><li><span>Toco</span><b>1</b></li><li><span>Transa</span><b>8</b></li><li><span>PT</span><b>−5</b></li>
    </ul>
    <p class="sub" style="margin:8px 0 0">Desempate: pontos, saídas (V), beijos menos tocos (SG).</p>
  </details>
  <div class="acct"><span class="kc">Conectado como ${esc(shownLogin)}</span><button class="btn ghost" data-logout>Sair</button></div>`;
}

/* ---------- Render ---------- */
const VIEWS = { tabela: viewTabela, feed: viewFeed, checkin: viewCheckin, desafios: viewDesafios, perfil: viewPerfil };
const TITLES = { tabela: "Tabela", feed: "Feed", checkin: "Postar", desafios: "Desafios", perfil: "Perfil" };
let rendered = "";
function route(){ const h = location.hash.slice(1); return VIEWS[h] ? h : "tabela"; }
function render(){
  const nav = $("nav.tabs");
  if (!configured){ nav.hidden = true; $("#pageTitle").textContent = "Quase lá"; $("#view").innerHTML = `<div class="empty"><b>Falta configurar</b>Cole as chaves do Firebase no arquivo config.js.</div>`; return; }
  if (!S.authReady){ nav.hidden = true; $("#pageTitle").textContent = ""; $("#view").innerHTML = `<div class="banner">Carregando…</div>`; return; }
  if (!S.me){ nav.hidden = true; $("#status").innerHTML = ""; $("#pageTitle").textContent = S.authMode === "criar" ? "Criar conta" : "Entrar"; if (rendered !== "auth-"+S.authMode){ $("#view").innerHTML = viewAuth(); rendered = "auth-"+S.authMode; } return; }
  if (S.member === null){ nav.hidden = true; $("#pageTitle").textContent = ""; $("#view").innerHTML = `<div class="banner">Carregando…</div>`; rendered = ""; return; }
  if (S.member === false){ nav.hidden = true; $("#pageTitle").textContent = "Bem-vindo"; if (rendered !== "join"){ $("#view").innerHTML = viewJoin(); rendered = "join"; } return; }
  nav.hidden = false;
  const r = route();
  document.querySelectorAll("nav.tabs a").forEach(a => { if (a.getAttribute("href") === "#"+r) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  $("#pageTitle").textContent = r === "checkin" && S.draft.editId ? "Editar rolê" : TITLES[r];
  $("#status").innerHTML = statusBanner();
  if (r === "checkin" && rendered === "checkin" && document.getElementById("ciForm")) { refreshPreview(); return; }
  if (r === "perfil" && rendered === "perfil" && document.activeElement?.id === "nick") return;
  $("#view").innerHTML = VIEWS[r]();
  rendered = r;
}
function refreshPreview(){
  const d = S.draft, prev = ciCalc({ type: d.type, n: d.n, pt: d.pt });
  const t = $("#pvTotal"); if (t){ t.textContent = (prev.total>=0?"+":"") + prev.total; t.className = prev.total < 0 ? "neg" : TYPES[d.type].cls; }
  ALL.forEach(x => { const btn = document.querySelector(`[data-step="${x.k}"][data-d="1"]`); if (!btn) return; const box = btn.closest(".stp"); const q = num(d.n[x.k]); box.querySelector(".ctl b").textContent = q; box.classList.toggle("has", q>0); });
}
window.addEventListener("hashchange", () => { rendered = ""; render(); window.scrollTo(0,0); });

/* ---------- Dados ao vivo ---------- */
function startData(){
  stopData();
  unsubs.push(onSnapshot(collection(db, "users"), snap => {
    const u = {}; snap.forEach(d => { u[d.id] = d.data(); }); S.users = u; render();
  }, e => { S.err = "Não deu para carregar os jogadores."; render(); }));
  unsubs.push(onSnapshot(query(collection(db, "checkins"), orderBy("ts", "desc")), snap => {
    S.checkins = snap.docs.map(d => ({ id: d.id, ...d.data() })); S.loaded = true; S.err = null; render();
  }, e => { S.err = "Não deu para carregar os rolês."; render(); }));
}
function stopData(){ unsubs.forEach(u => u()); unsubs = []; }

async function checkMember(uid){
  try { const snap = await getDoc(doc(db, "users", uid)); S.member = snap.exists(); }
  catch(e){ S.member = false; }
  if (S.member) startData();
  rendered = ""; render();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async e => {
  const am = e.target.closest("[data-authmode]"); if (am){ S.authMode = am.dataset.authmode; rendered = ""; render(); return; }
  if (e.target.closest("[data-logout]")){ stopData(); S.authMode = "entrar"; S.member = null; S.joinErr = ""; await signOut(auth); return; }
  if (e.target.id === "forgot"){
    const m = $("#authMsg"), info = toLoginEmail($("#aLogin").value || "");
    if (!info || info.isPhone){ m.className = "msg err"; m.textContent = info?.isPhone ? "Quem entra pelo celular precisa pedir para o organizador redefinir a senha." : "Digite seu e-mail acima primeiro."; return; }
    try { await sendPasswordResetEmail(auth, info.email); m.className = "msg"; m.textContent = "Enviamos um link para o seu e-mail."; } catch(err){ m.className = "msg err"; m.textContent = authError(err); }
    return; }
  const st = e.target.closest("[data-step]");
  if (st){ const k = st.dataset.step; S.draft.n[k] = Math.max(0, num(S.draft.n[k]) + (+st.dataset.d)); refreshPreview(); return; }
  const tq = e.target.closest("[data-togglequick]");
  if (tq){ const id = tq.dataset.togglequick; openQuick.has(id) ? openQuick.delete(id) : openQuick.add(id); render(); return; }
  const qk = e.target.closest("[data-quick]");
  if (qk){ qk.disabled = true; try { await updateDoc(doc(db, "checkins", qk.dataset.cid), { ["n." + qk.dataset.quick]: increment(1) }); } catch(err){} qk.disabled = false; return; }
  const qp = e.target.closest("[data-quickpt]");
  if (qp){ const c = S.checkins.find(x => x.id === qp.dataset.quickpt); if (c) try { await updateDoc(doc(db, "checkins", c.id), { pt: !c.pt }); } catch(err){} return; }
  const kd = e.target.closest("[data-kudo]");
  if (kd){ const c = S.checkins.find(x => x.id === kd.dataset.kudo); if (!c) return; kd.disabled = true;
    try { await updateDoc(doc(db, "checkins", c.id), { kudos: (c.kudos||[]).includes(S.me) ? arrayRemove(S.me) : arrayUnion(S.me) }); } catch(err){ kd.disabled = false; }
    return; }
  const ed = e.target.closest("[data-edit]");
  if (ed){
    const c = S.checkins.find(x => x.id === ed.dataset.edit); if (!c) return;
    S.draft = { type: TYPES[c.type] ? c.type : "festa", place: c.place || "", when: localInput(new Date(c.ts)), n: { ...(c.n||{}) }, pt: !!c.pt, note: c.note || "", photoData: "", editId: c.id, photoId: c.photoId || null };
    if (location.hash === "#checkin"){ rendered = ""; render(); window.scrollTo(0,0); } else location.hash = "#checkin";
    return; }
  if (e.target.id === "cancelEdit"){ S.draft = freshDraft(); rendered = ""; render(); return; }
  const del = e.target.closest("[data-del]");
  if (del){
    if (del.dataset.confirm !== "1"){ del.dataset.confirm = "1"; del.textContent = "Toque de novo para apagar"; setTimeout(()=>{ if(del.isConnected){ del.dataset.confirm=""; del.textContent="Apagar rolê"; } }, 4000); return; }
    const id = del.dataset.del, c = S.checkins.find(x => x.id === id); del.disabled = true;
    try {
      await deleteDoc(doc(db, "checkins", id));
      if (c?.photoId) deleteDoc(doc(db, "photos", c.photoId)).catch(()=>{});
      S.draft = freshDraft(); location.hash = "#feed";
    } catch(err){ del.disabled = false; }
    return; }
  if (e.target.id === "saveNick"){
    const v = $("#nick").value.trim().slice(0,24), m = $("#nickMsg");
    if (!v){ m.className = "msg err"; m.textContent = "Escreva um apelido."; return; }
    try { await updateDoc(doc(db, "users", S.me), { nick: v }); m.className = "msg"; m.textContent = "Salvo."; } catch(err){ m.className = "msg err"; m.textContent = "Não salvou. Tente de novo."; }
  }
});
document.addEventListener("change", async e => {
  const t = e.target, d = S.draft;
  if (t.id === "photo" && t.files && t.files[0]){
    const m = $("#ciMsg");
    try {
      d.photoData = await shrinkToDataUrl(t.files[0]);
      const drop = document.querySelector("label.drop");
      drop.querySelectorAll("b,span,img").forEach(n => n.remove());
      const img = document.createElement("img"); img.src = d.photoData; img.alt = "Prévia da foto"; drop.prepend(img);
      if (m){ m.className = "msg"; m.textContent = ""; }
    } catch(err){ if (m){ m.className = "msg err"; m.textContent = "Não consegui abrir essa imagem. Tente outra foto."; } }
  }
  if (t.id === "pt"){ d.pt = t.checked; refreshPreview(); }
});
document.addEventListener("input", e => {
  const t = e.target, d = S.draft;
  if (t.name === "type"){ d.type = t.value; refreshPreview(); }
  else if (t.id === "place") d.place = t.value;
  else if (t.id === "when") d.when = t.value;
  else if (t.id === "note") d.note = t.value;
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "authForm"){
    const m = $("#authMsg"), btn = $("#authSubmit"), signup = S.authMode === "criar";
    const info = toLoginEmail($("#aLogin").value || ""), pass = $("#aPass").value;
    const fail = txt => { m.className = "msg err"; m.textContent = txt; btn.disabled = false; };
    if (!info) return fail("Digite um e-mail ou um celular com DDD.");
    if (pass.length < 6) return fail("A senha precisa ter pelo menos 6 caracteres.");
    let nick = "", code = "";
    if (signup){ nick = $("#aNick").value.trim().slice(0,24); code = $("#aCode").value.trim().toUpperCase();
      if (!nick) return fail("Escolha um apelido."); if (!code) return fail("Coloque o código da liga."); }
    btn.disabled = true; m.className = "msg"; m.textContent = signup ? "Criando conta…" : "Entrando…";
    try {
      if (signup){
        S.signingUp = true;
        let cred;
        try { cred = await createUserWithEmailAndPassword(auth, info.email, pass); }
        catch(err){ S.signingUp = false; throw err; }
        S.me = cred.user.uid; S.authReady = true;
        try { await setDoc(doc(db, "users", cred.user.uid), { nick, invite: code, createdAt: serverTimestamp() }); S.member = true; S.joinErr = ""; startData(); }
        catch(err){ S.member = false; S.joinErr = "Código da liga errado. Confira com quem te convidou."; }
        S.signingUp = false; rendered = ""; render();
      } else {
        await signInWithEmailAndPassword(auth, info.email, pass);
      }
    } catch(err){ fail(authError(err)); }
    return;
  }
  if (f.id === "joinForm"){
    const m = $("#joinMsg"), nick = $("#jNick").value.trim().slice(0,24), code = $("#jCode").value.trim().toUpperCase();
    if (!nick || !code){ m.className = "msg err"; m.textContent = "Preencha o apelido e o código."; return; }
    try { await setDoc(doc(db, "users", S.me), { nick, invite: code, createdAt: serverTimestamp() }); S.member = true; startData(); rendered = ""; render(); }
    catch(err){ S.joinErr = "Código da liga errado. Confira com quem te convidou."; m.className = "msg err"; m.textContent = S.joinErr; }
    return;
  }
  if (f.id !== "ciForm") return;
  const d = S.draft, m = $("#ciMsg"), btn = $("#ciSubmit");
  const fail = txt => { m.className = "msg err"; m.textContent = txt; btn.disabled = false; };
  if (!d.photoData && !d.photoId) return fail("Falta a foto. Sem foto, não vale!");
  const ts = d.when ? new Date(d.when).getTime() : Date.now();
  if (!isFinite(ts)) return fail("Data inválida.");
  if (ts > Date.now() + 6*3600000) return fail("Só vale rolê que já aconteceu (ou está acontecendo).");
  btn.disabled = true; m.className = "msg"; m.textContent = d.photoData ? "Enviando foto…" : "Salvando…";
  try {
    let photoId = d.photoId, oldPhoto = null;
    if (d.photoData){
      const ref = await addDoc(collection(db, "photos"), { uid: S.me, data: d.photoData, createdAt: serverTimestamp() });
      S.photos[ref.id] = d.photoData;
      if (d.editId && d.photoId) oldPhoto = d.photoId;
      photoId = ref.id;
    }
    m.textContent = "Salvando…";
    const n = {}; for (const x of ALL) if (num(d.n[x.k])) n[x.k] = num(d.n[x.k]);
    const data = { uid: S.me, ts, type: d.type, place: d.place.trim().slice(0,60), n, pt: !!d.pt, note: d.note.trim().slice(0,280), photoId };
    if (d.editId) await updateDoc(doc(db, "checkins", d.editId), data);
    else await addDoc(collection(db, "checkins"), { ...data, kudos: [], createdAt: serverTimestamp() });
    if (oldPhoto) deleteDoc(doc(db, "photos", oldPhoto)).catch(()=>{});
    S.draft = freshDraft();
    location.hash = "#feed";
  } catch(err){ fail("Não salvou. Confira sua conexão e tente de novo."); }
});

/* ---------- Início ---------- */
tickCountdown(); setInterval(tickCountdown, 30000);
render();
if (auth){
  setPersistence(auth, browserLocalPersistence).catch(()=>{});
  onAuthStateChanged(auth, user => {
    S.authReady = true;
    if (S.signingUp && user) { S.me = user.uid; return; }
    S.me = user ? user.uid : null; S.member = user ? (S.member === true ? true : null) : null;
    rendered = "";
    if (!user){ stopData(); S.users = {}; S.checkins = []; S.loaded = false; render(); return; }
    if (S.signingUp) return;
    if (S.member === true){ render(); return; }
    render(); checkMember(user.uid);
  });
}
