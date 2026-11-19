/* Calculadora de Preços — lógica principal (dados salvos no aparelho) */
(function () {
  'use strict';

  const CHAVE = 'calculadora-precos-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------------------------------------------------------------- dados
  const padrao = () => ({
    config: { margemPadrao: 30, arredondar: 'nenhum', apiKey: '' },
    categorias: [{ id: 'geral', nome: 'Geral', margem: 30 }],
    produtos: [],
    historico: []
  });

  function carregar() {
    try {
      const bruto = localStorage.getItem(CHAVE);
      if (!bruto) return padrao();
      const d = JSON.parse(bruto);
      const p = padrao();
      return {
        config: { ...p.config, ...(d.config || {}) },
        categorias: d.categorias && d.categorias.length ? d.categorias : p.categorias,
        produtos: d.produtos || [],
        historico: d.historico || []
      };
    } catch (e) { console.warn(e); return padrao(); }
  }
  let db = carregar();
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(db)); }
    catch (e) { aviso('Não foi possível salvar no aparelho: ' + e.message); }
    atualizarTopo();
  }

  // ---------------------------------------------------------------- utilidades
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const normalizar = s => (s || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    let s = (v || '').toString().trim().replace(/[R$\s%]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }
  const brl = v => isFinite(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ —';
  const pct = (v, casas = 1) => isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas }) + '%' : '—';
  const sinal = v => (v > 0 ? '+' : v < 0 ? '−' : '');
  const fmtNum = (v, casas = 2) => isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '';
  const data = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function arredondar(preco) {
    if (!isFinite(preco) || preco <= 0) return preco;
    const c = Math.round(preco * 100); // centavos
    switch (db.config.arredondar) {
      case '10': return Math.ceil(c / 10) * 10 / 100;
      case '50': return Math.ceil(c / 50) * 50 / 100;
      case '99': return (Math.ceil((c - 99) / 100) * 100 + 99) / 100;
      case '90': return (Math.ceil((c - 90) / 100) * 100 + 90) / 100;
      default: return c / 100;
    }
  }
  /** Preço = custo + % de lucro em cima do custo */
  function calcularPreco(custo, margem) {
    if (!isFinite(custo) || custo <= 0 || !isFinite(margem)) return NaN;
    return arredondar(custo * (1 + margem / 100));
  }
  const margemReal = (custo, preco) => (custo > 0 ? (preco / custo - 1) * 100 : NaN);

  function categoria(id) { return db.categorias.find(c => c.id === id) || db.categorias[0]; }
  function margemDaCategoria(id) {
    const c = db.categorias.find(c => c.id === id);
    return c ? c.margem : db.config.margemPadrao;
  }
  function opcoesCategorias(sel) {
    return db.categorias.map(c =>
      `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.nome)} (${pct(c.margem)})</option>`).join('');
  }

  function aviso(msg) {
    const el = $('#aviso');
    el.textContent = msg;
    el.classList.add('visivel');
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => el.classList.remove('visivel'), 2800);
  }

  function htmlComparacao(custo, calculado, manual, margemAplicada) {
    if (!isFinite(manual) || manual <= 0 || !isFinite(calculado)) return '';
    const dif = manual - calculado;
    const difPct = dif / calculado * 100;
    const real = margemReal(custo, manual);
    const cls = dif >= 0 ? 'pos' : 'neg';
    return `Calculado: <b>${brl(calculado)}</b> (${pct(margemAplicada)})<br>
      Manual: <b>${brl(manual)}</b><br>
      Diferença: <span class="${cls}">${sinal(dif)}${brl(Math.abs(dif))} (${sinal(difPct)}${pct(Math.abs(difPct))})</span><br>
      Lucro real com esse preço: <b>${pct(real)}</b> — ${brl(manual - custo)} por unidade`;
  }

  // ---------------------------------------------------------------- produtos e histórico
  function salvarProduto({ nome, custo, categoriaId, margem, precoFinal, manual }) {
    nome = (nome || '').trim();
    if (!nome) nome = 'Produto sem nome';
    const chave = normalizar(nome);
    const calculado = calcularPreco(custo, margem);
    let p = db.produtos.find(x => normalizar(x.nome) === chave);
    const agora = new Date().toISOString();
    if (!p) { p = { id: uid(), nome, criado: agora }; db.produtos.push(p); }
    Object.assign(p, {
      nome, custo, categoriaId, margem,
      precoCalculado: calculado,
      precoFinal: manual ? precoFinal : calculado,
      manual: !!manual,
      atualizado: agora
    });
    return p;
  }

  function registrarAjuste(prod, precoManual) {
    const calculado = calcularPreco(prod.custo, prod.margem);
    const dif = precoManual - calculado;
    const reg = {
      id: uid(),
      data: new Date().toISOString(),
      produtoId: prod.id,
      nome: prod.nome,
      categoriaId: prod.categoriaId,
      categoria: categoria(prod.categoriaId).nome,
      custo: prod.custo,
      margemAplicada: prod.margem,
      precoCalculado: calculado,
      precoManual,
      diferenca: dif,
      diferencaPct: dif / calculado * 100,
      margemReal: margemReal(prod.custo, precoManual)
    };
    db.historico.unshift(reg);
    prod.precoFinal = precoManual;
    prod.manual = true;
    prod.atualizado = reg.data;
    return reg;
  }

  function ultimoAjuste(nome) {
    const k = normalizar(nome);
    return db.historico.find(h => normalizar(h.nome) === k);
  }

  // ---------------------------------------------------------------- modal de ajuste manual
  /** Abre o modal e devolve o preço manual escolhido (ou null). */
  function pedirPrecoManual({ nome, custo, margem, precoAtual }) {
    const dlg = $('#modalManual');
    const calculado = calcularPreco(custo, margem);
    $('#mTitulo').textContent = 'Ajuste manual — ' + nome;
    $('#mInfo').innerHTML = `Custo: <b>${brl(custo)}</b> · Lucro: <b>${pct(margem)}</b><br>Preço calculado: <b>${brl(calculado)}</b>`;
    const inp = $('#mPreco');
    inp.value = fmtNum(precoAtual || calculado);
    const atualizar = () => { $('#mComparacao').innerHTML = htmlComparacao(custo, calculado, num(inp.value), margem); };
    inp.oninput = atualizar;
    atualizar();
    return new Promise(res => {
      dlg.onclose = () => {
        const v = num(inp.value);
        res(dlg.returnValue === 'ok' && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
      };
      dlg.returnValue = '';
      dlg.showModal();
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
    });
  }

  // ---------------------------------------------------------------- abas
  function abrirAba(nome) {
    $$('.aba').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
    $$('.painel').forEach(p => p.classList.toggle('ativo', p.id === nome));
    if (nome === 'produtos') renderProdutos();
    if (nome === 'historico') renderHistorico();
    if (nome === 'ajustes') renderAjustes();
    if (nome === 'calcular') renderCalcular();
    try { sessionStorage.setItem('aba', nome); } catch (e) { /* sem storage */ }
  }
  $$('.aba').forEach(b => b.addEventListener('click', () => abrirAba(b.dataset.aba)));

  function atualizarTopo() {
    $('#resumoTopo').textContent =
      `${db.produtos.length} produtos · ${db.historico.length} ajustes manuais · lucro padrão ${pct(db.config.margemPadrao)}`;
  }

  // ---------------------------------------------------------------- CALCULAR
  const cNome = $('#cNome'), cCusto = $('#cCusto'), cCat = $('#cCategoria'), cMargem = $('#cMargem');
  const cManual = $('#cManual');
  let modoManual = false;

  function renderCalcular() {
    const sel = cCat.value || db.categorias[0].id;
    cCat.innerHTML = opcoesCategorias(sel);
    $('#listaProdutos').innerHTML = db.produtos.map(p => `<option value="${esc(p.nome)}">`).join('');
    recalcular();
  }

  function recalcular() {
    const custo = num(cCusto.value), margem = num(cMargem.value);
    const preco = calcularPreco(custo, margem);
    $('#cPreco').textContent = brl(isFinite(preco) ? preco : 0);
    let det = isFinite(preco) ? `Lucro por unidade: ${brl(preco - custo)}` : 'Digite o custo do produto';
    const ult = cNome.value.trim() && ultimoAjuste(cNome.value);
    if (ult) det += ` · Último ajuste manual: ${brl(ult.precoManual)} em ${data(ult.data)} (lucro real ${pct(ult.margemReal)})`;
    $('#cDetalhe').textContent = det;
    if (modoManual) $('#cComparacao').innerHTML = htmlComparacao(custo, preco, num(cManual.value), margem);
  }

  cCusto.addEventListener('input', recalcular);
  cMargem.addEventListener('input', recalcular);
  cManual.addEventListener('input', recalcular);
  cCat.addEventListener('change', () => { cMargem.value = fmtNum(margemDaCategoria(cCat.value), 0); recalcular(); });
  cNome.addEventListener('change', () => {
    const p = db.produtos.find(x => normalizar(x.nome) === normalizar(cNome.value));
    if (p) {
      cCusto.value = fmtNum(p.custo);
      cCat.value = p.categoriaId;
      cMargem.value = fmtNum(p.margem, 0);
    }
    recalcular();
  });
  $$('#calcular [data-delta]').forEach(b => b.addEventListener('click', () => {
    const m = (num(cMargem.value) || 0) + Number(b.dataset.delta);
    cMargem.value = fmtNum(Math.max(0, m), 0);
    recalcular();
  }));

  $('#btnManual').addEventListener('click', () => {
    modoManual = !modoManual;
    $('#cManualBox').classList.toggle('oculto', !modoManual);
    $('#btnManual').textContent = modoManual ? 'Cancelar ajuste manual' : 'Ajustar preço manualmente';
    if (modoManual) {
      const p = calcularPreco(num(cCusto.value), num(cMargem.value));
      cManual.value = isFinite(p) ? fmtNum(p) : '';
      cManual.focus(); cManual.select();
    }
    recalcular();
  });

  $('#btnSalvar').addEventListener('click', () => {
    const custo = num(cCusto.value), margem = num(cMargem.value);
    if (!(custo > 0)) { aviso('Digite o custo do produto'); cCusto.focus(); return; }
    if (!isFinite(margem)) { aviso('Digite a % de lucro'); cMargem.focus(); return; }
    const manualV = num(cManual.value);
    const usarManual = modoManual && manualV > 0;
    const prod = salvarProduto({ nome: cNome.value, custo, categoriaId: cCat.value, margem });
    if (usarManual) {
      const r = registrarAjuste(prod, Math.round(manualV * 100) / 100);
      aviso(`Salvo com ajuste manual (${sinal(r.diferenca)}${brl(Math.abs(r.diferenca))})`);
    } else {
      aviso('Produto salvo: ' + brl(prod.precoFinal));
    }
    salvar();
    limparCalcular();
  });

  function limparCalcular() {
    cNome.value = ''; cCusto.value = ''; cManual.value = '';
    cMargem.value = fmtNum(margemDaCategoria(cCat.value), 0);
    if (modoManual) $('#btnManual').click();
    renderCalcular();
    cNome.focus();
  }
  $('#btnLimpar').addEventListener('click', limparCalcular);

  // ---------------------------------------------------------------- PRODUTOS
  function renderProdutos() {
    const q = normalizar($('#pBusca').value);
    const lista = db.produtos
      .filter(p => !q || normalizar(p.nome).includes(q))
      .sort((a, b) => b.atualizado.localeCompare(a.atualizado));
    const el = $('#pLista');
    if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum produto salvo ainda.</div>'; return; }
    el.innerHTML = lista.map(p => `
      <div class="item" data-id="${p.id}">
        <div>
          <div class="nome">${esc(p.nome)} ${p.manual ? '<span class="tag manual">manual</span>' : ''}</div>
          <div class="meta">Custo ${brl(p.custo)} · ${esc(categoria(p.categoriaId).nome)} · ${pct(p.margem)}
            ${p.manual ? ` · calculado ${brl(calcularPreco(p.custo, p.margem))} · lucro real ${pct(margemReal(p.custo, p.precoFinal))}` : ''}
            · ${data(p.atualizado)}</div>
        </div>
        <div class="preco">${brl(p.precoFinal)}</div>
        <div class="acoes">
          <button class="btn-mini" data-acao="manual">Ajustar preço</button>
          <button class="btn-mini" data-acao="editar">Editar / recalcular</button>
          ${p.manual ? '<button class="btn-mini" data-acao="voltar">Voltar ao calculado</button>' : ''}
          <button class="btn-mini" data-acao="excluir">Excluir</button>
        </div>
      </div>`).join('');
  }
  $('#pBusca').addEventListener('input', renderProdutos);
  $('#pLista').addEventListener('click', async e => {
    const b = e.target.closest('button[data-acao]'); if (!b) return;
    const p = db.produtos.find(x => x.id === b.closest('.item').dataset.id); if (!p) return;
    const acao = b.dataset.acao;
    if (acao === 'manual') {
      const v = await pedirPrecoManual({ nome: p.nome, custo: p.custo, margem: p.margem, precoAtual: p.precoFinal });
      if (v != null) { registrarAjuste(p, v); salvar(); aviso('Ajuste manual salvo'); renderProdutos(); }
    } else if (acao === 'editar') {
      abrirAba('calcular');
      cNome.value = p.nome; cCusto.value = fmtNum(p.custo); cCat.value = p.categoriaId; cMargem.value = fmtNum(p.margem, 0);
      recalcular();
    } else if (acao === 'voltar') {
      p.precoFinal = calcularPreco(p.custo, p.margem); p.manual = false; p.atualizado = new Date().toISOString();
      salvar(); renderProdutos();
    } else if (acao === 'excluir') {
      if (confirm(`Excluir "${p.nome}"? (o histórico de ajustes continua guardado)`)) {
        db.produtos = db.produtos.filter(x => x !== p); salvar(); renderProdutos();
      }
    }
  });

  // ---------------------------------------------------------------- HISTÓRICO
  function renderHistorico() {
    // Resumo por ramo
    const grupos = {};
    db.historico.forEach(h => {
      const k = h.categoriaId || 'geral';
      (grupos[k] = grupos[k] || []).push(h);
    });
    const resumo = $('#hResumo');
    const ids = Object.keys(grupos);
    if (!ids.length) {
      resumo.innerHTML = '<div class="vazio">Quando houver ajustes manuais, a comparação aparece aqui.</div>';
    } else {
      resumo.innerHTML = ids.map(id => {
        const hs = grupos[id];
        const cat = db.categorias.find(c => c.id === id);
        const media = hs.reduce((s, h) => s + h.margemReal, 0) / hs.length;
        const mediaDif = hs.reduce((s, h) => s + h.diferencaPct, 0) / hs.length;
        const sugest = Math.round(media);
        return `<div class="resumo">
          <div class="nome">${esc(cat ? cat.nome : hs[0].categoria)}</div>
          <div class="grande">${pct(media)}</div>
          <div class="meta">lucro real médio em ${hs.length} ajuste(s)<br>
            % configurada: ${cat ? pct(cat.margem) : '—'} · diferença média ${sinal(mediaDif)}${pct(Math.abs(mediaDif))}</div>
          ${cat && sugest !== Math.round(cat.margem) ? `<button class="btn-mini" data-usar="${esc(id)}" data-valor="${sugest}" style="margin-top:6px">Usar ${sugest}% neste ramo</button>` : ''}
        </div>`;
      }).join('');
    }

    const q = normalizar($('#hBusca').value);
    const lista = db.historico.filter(h => !q || normalizar(h.nome).includes(q) || normalizar(h.categoria).includes(q));
    const el = $('#hLista');
    if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum ajuste manual registrado.</div>'; return; }
    el.innerHTML = lista.map(h => {
      const cls = h.diferenca >= 0 ? 'pos' : 'neg';
      return `<div class="item" data-id="${h.id}">
        <div>
          <div class="nome">${esc(h.nome)} <span class="tag">${esc(h.categoria)}</span></div>
          <div class="meta">${data(h.data)} · custo ${brl(h.custo)} · calculado ${brl(h.precoCalculado)} (${pct(h.margemAplicada)})</div>
          <div class="meta comparacao">Diferença <span class="${cls}">${sinal(h.diferenca)}${brl(Math.abs(h.diferenca))} (${sinal(h.diferencaPct)}${pct(Math.abs(h.diferencaPct))})</span> · lucro real <b>${pct(h.margemReal)}</b></div>
        </div>
        <div class="preco">${brl(h.precoManual)}</div>
        <div class="acoes"><button class="btn-mini" data-excluir="${h.id}">Excluir registro</button></div>
      </div>`;
    }).join('');
  }
  $('#hBusca').addEventListener('input', renderHistorico);
  $('#hResumo').addEventListener('click', e => {
    const b = e.target.closest('[data-usar]'); if (!b) return;
    const c = db.categorias.find(x => x.id === b.dataset.usar);
    if (c && confirm(`Mudar o lucro do ramo "${c.nome}" de ${pct(c.margem)} para ${b.dataset.valor}%?`)) {
      c.margem = Number(b.dataset.valor); salvar(); renderHistorico(); aviso('Ramo atualizado');
    }
  });
  $('#hLista').addEventListener('click', e => {
    const b = e.target.closest('[data-excluir]'); if (!b) return;
    if (confirm('Excluir este registro do histórico?')) {
      db.historico = db.historico.filter(h => h.id !== b.dataset.excluir); salvar(); renderHistorico();
    }
  });

  function baixar(nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a'); a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('#hExportar').addEventListener('click', () => {
    const col = ['Data', 'Produto', 'Ramo', 'Custo', '% aplicada', 'Preço calculado', 'Preço manual', 'Diferença R$', 'Diferença %', 'Lucro real %'];
    const f = v => fmtNum(v);
    const linhas = db.historico.map(h => [data(h.data), h.nome, h.categoria, f(h.custo), f(h.margemAplicada), f(h.precoCalculado), f(h.precoManual), f(h.diferenca), f(h.diferencaPct), f(h.margemReal)]);
    const csv = [col, ...linhas].map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    baixar('ajustes-manuais.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  });

  // ---------------------------------------------------------------- AJUSTES
  function renderAjustes() {
    $('#aMargem').value = fmtNum(db.config.margemPadrao, 0);
    $('#aArredondar').value = db.config.arredondar;
    $('#aApiKey').value = db.config.apiKey || '';
    $('#aCategorias').innerHTML = db.categorias.map(c => `
      <div class="cat-linha" data-id="${esc(c.id)}">
        <input type="text" data-campo="nome" value="${esc(c.nome)}">
        <input type="text" data-campo="margem" inputmode="decimal" value="${fmtNum(c.margem, 0)}">
        <button class="btn-mini" data-remover ${db.categorias.length < 2 ? 'disabled' : ''}>Remover</button>
      </div>`).join('');
  }
  $('#aMargem').addEventListener('change', e => {
    const v = num(e.target.value);
    if (isFinite(v) && v >= 0) {
      const geral = db.categorias.find(c => c.id === 'geral');
      if (geral && geral.margem === db.config.margemPadrao) geral.margem = v;
      db.config.margemPadrao = v; salvar(); renderAjustes(); aviso('Lucro padrão: ' + pct(v));
    }
  });
  $('#aArredondar').addEventListener('change', e => { db.config.arredondar = e.target.value; salvar(); aviso('Arredondamento salvo'); });
  $('#aApiKey').addEventListener('change', e => { db.config.apiKey = e.target.value.trim(); salvar(); aviso('Chave salva neste aparelho'); });
  $('#aCategorias').addEventListener('change', e => {
    const linha = e.target.closest('.cat-linha'); const c = db.categorias.find(x => x.id === linha.dataset.id);
    if (!c) return;
    if (e.target.dataset.campo === 'nome' && e.target.value.trim()) c.nome = e.target.value.trim();
    if (e.target.dataset.campo === 'margem') { const v = num(e.target.value); if (isFinite(v) && v >= 0) c.margem = v; }
    salvar(); aviso('Ramo atualizado');
  });
  $('#aCategorias').addEventListener('click', e => {
    if (!e.target.matches('[data-remover]')) return;
    const id = e.target.closest('.cat-linha').dataset.id;
    const c = db.categorias.find(x => x.id === id);
    if (!confirm(`Remover o ramo "${c.nome}"? Produtos dele passam para "${db.categorias.find(x => x.id !== id).nome}".`)) return;
    db.categorias = db.categorias.filter(x => x.id !== id);
    db.produtos.forEach(p => { if (p.categoriaId === id) p.categoriaId = db.categorias[0].id; });
    salvar(); renderAjustes();
  });
  $('#aAddCat').addEventListener('click', () => {
    const nome = $('#aNovaCat').value.trim(); const m = num($('#aNovaCatMargem').value);
    if (!nome) { aviso('Digite o nome do ramo'); return; }
    db.categorias.push({ id: uid(), nome, margem: isFinite(m) ? m : db.config.margemPadrao });
    $('#aNovaCat').value = ''; $('#aNovaCatMargem').value = '';
    salvar(); renderAjustes(); aviso('Ramo adicionado');
  });
  $('#aExportar').addEventListener('click', () => {
    const copia = { ...db, config: { ...db.config, apiKey: '' } };
    baixar(`backup-precos-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(copia, null, 2), 'application/json');
  });
  $('#aImportar').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.produtos || !d.categorias) throw new Error('arquivo não parece um backup');
      if (!confirm('Substituir os dados atuais pelo backup?')) return;
      const chave = db.config.apiKey;
      db = { ...padrao(), ...d, config: { ...padrao().config, ...d.config, apiKey: chave } };
      salvar(); renderAjustes(); aviso('Backup restaurado');
    } catch (err) { aviso('Erro ao ler backup: ' + err.message); }
    e.target.value = '';
  });
  $('#aApagar').addEventListener('click', () => {
    if (confirm('Apagar TODOS os produtos, ramos e histórico? Isso não tem volta.')) {
      db = padrao(); salvar(); renderAjustes(); aviso('Dados apagados');
    }
  });

  // ---------------------------------------------------------------- API para a tela da nota
  window.App = {
    get db() { return db; },
    num, brl, pct, fmtNum, esc, normalizar, aviso,
    calcularPreco, margemDaCategoria, opcoesCategorias, categoria,
    salvarProduto, registrarAjuste, pedirPrecoManual, salvar
  };

  // ---------------------------------------------------------------- início
  cMargem.value = fmtNum(margemDaCategoria(db.categorias[0].id), 0);
  atualizarTopo();
  let abaInicial = 'calcular';
  try { abaInicial = sessionStorage.getItem('aba') || 'calcular'; } catch (e) { /* sem storage */ }
  abrirAba(abaInicial);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
