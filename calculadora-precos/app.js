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
    historico: [],
    variacoes: []
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
        produtos: (d.produtos || []).map(migrarProduto),
        historico: d.historico || [],
        variacoes: d.variacoes || []
      };
    } catch (e) { console.warn(e); return padrao(); }
  }
  function migrarProduto(p) {
    if (!Array.isArray(p.custos)) p.custos = [{ data: p.atualizado || p.criado || new Date().toISOString(), custo: p.custo }];
    return p;
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
  /**
   * Salva/atualiza um produto. Se produtoId vier (produto reconhecido), atualiza esse produto
   * e guarda o nome da nota como "apelido" para reconhecer direto na próxima vez.
   */
  function salvarProduto({ nome, custo, categoriaId, margem, precoFinal, manual, produtoId, ean, porKg }) {
    nome = (nome || '').trim();
    if (!nome) nome = 'Produto sem nome';
    const chave = normalizar(nome);
    const calculado = calcularPreco(custo, margem);
    let p = produtoId ? db.produtos.find(x => x.id === produtoId) : null;
    if (!p) p = (ean && db.produtos.find(x => x.ean === ean)) || produtoPorNome(nome);
    const agora = new Date().toISOString();
    let variacao = null;
    if (!p) {
      const bonito = window.Reconhecer.nomeAmigavel(nome);
      p = { id: uid(), nome: bonito, criado: agora, custos: [{ data: agora, custo }], apelidos: bonito !== nome ? [nome] : [] };
      db.produtos.push(p);
    } else {
      migrarProduto(p);
      if (normalizar(p.nome) !== chave && !(p.apelidos || []).some(a => normalizar(a) === chave)) {
        (p.apelidos = p.apelidos || []).push(nome);
      }
      variacao = compararCusto(p, custo);
      if (variacao) {
        variacao = {
          ...variacao, id: uid(), data: agora, produtoId: p.id, nome: p.nome,
          precoVendaAnterior: p.precoFinal, precoVendaNovo: calculado
        };
        db.variacoes.unshift(variacao);
        p.custos.push({ data: agora, custo });
        p.ultimaVariacao = variacao;
      }
    }
    if (ean) p.ean = ean;
    if (porKg !== undefined) p.porKg = !!porKg;
    Object.assign(p, {
      custo, categoriaId, margem,
      precoCalculado: calculado,
      precoFinal: manual ? precoFinal : calculado,
      manual: !!manual,
      atualizado: agora
    });
    p.variacaoAgora = variacao; // apenas para avisar quem chamou (não precisa persistir)
    return p;
  }

  /** Compara um custo novo com o último custo salvo do produto. null = igual ou sem custo anterior */
  function compararCusto(prod, custoNovo) {
    if (!prod || !(prod.custo > 0) || !(custoNovo > 0)) return null;
    const dif = custoNovo - prod.custo;
    if (Math.abs(dif) < 0.005) return null;
    const ult = (prod.custos && prod.custos[prod.custos.length - 1]) || {};
    return {
      custoAnterior: prod.custo,
      custoNovo,
      dataAnterior: ult.data || prod.atualizado,
      diferenca: dif,
      diferencaPct: dif / prod.custo * 100
    };
  }
  /** Produto com exatamente esse nome (ou apelido) */
  function produtoPorNome(nome) {
    const k = normalizar(nome);
    if (!k) return null;
    return db.produtos.find(x => normalizar(x.nome) === k || (x.apelidos || []).some(a => normalizar(a) === k)) || null;
  }

  const RECONHECER_AUTO = 0.8; // a partir daqui o produto é ligado sozinho (ela pode trocar)
  /** Produtos parecidos por nome + peso/volume + marca (ou código de barras). [{prod, score}] */
  function encontrarParecidos(nome, ean, limite = 3) {
    const R = window.Reconhecer;
    const k = R.chave(nome);
    const out = [];
    for (const p of db.produtos) {
      let score = 0;
      if (ean && p.ean === ean) score = 1;
      else {
        for (const n of [p.nome, ...(p.apelidos || [])]) {
          score = Math.max(score, normalizar(n) === normalizar(nome) ? 1 : R.similaridade(k, R.chave(n)));
          if (score === 1) break;
        }
      }
      if (score >= 0.45) out.push({ prod: p, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limite);
  }

  function textoVariacao(v) {
    const sobe = v.diferenca > 0;
    return `${sobe ? '▲ Aumentou' : '▼ Baixou'} ${brl(Math.abs(v.diferenca))} (${sinal(v.diferencaPct)}${pct(Math.abs(v.diferencaPct))})`;
  }
  function htmlVariacao(v, prod, margem) {
    if (!v) return '';
    const sobe = v.diferenca > 0;
    const novoPreco = calcularPreco(v.custoNovo, margem);
    return `<div class="variacao ${sobe ? 'sobe' : 'desce'}">
      <b>${textoVariacao(v)}</b> desde a última compra<br>
      Custo: ${brl(v.custoAnterior)} em ${data(v.dataAnterior)} → <b>${brl(v.custoNovo)}</b><br>
      Preço de venda: ${brl(prod.precoFinal)} → <b>${brl(novoPreco)}</b>${prod.manual ? ' (antes era ajuste manual)' : ''}
    </div>`;
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
    if (nome === 'historico') { renderHistorico(); renderVariacoes(); }
    if (nome === 'ajustes') renderAjustes();
    if (nome === 'calcular') renderCalcular();
    try { sessionStorage.setItem('aba', nome); } catch (e) { /* sem storage */ }
  }
  $$('.aba').forEach(b => b.addEventListener('click', () => abrirAba(b.dataset.aba)));

  function atualizarTopo() {
    $('#resumoTopo').textContent =
      `${db.produtos.length} produtos · ${db.historico.length} ajustes manuais · ${db.variacoes.filter(v => v.diferenca > 0).length} aumentos de custo · lucro ${pct(db.config.margemPadrao)}`;
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
    const prod = cNome.value.trim() && produtoPorNome(cNome.value);
    let sugestao = '';
    if (!prod && cNome.value.trim().length >= 4) {
      const [m] = encontrarParecidos(cNome.value);
      if (m && m.score >= 0.55) {
        sugestao = `<div class="variacao igual">Parece ser <b>${esc(m.prod.nome)}</b> (${Math.round(m.score * 100)}% parecido)
          <button type="button" class="btn-mini" id="cUsarSugestao" data-nome="${esc(m.prod.nome)}">Usar este</button></div>`;
      }
    }
    $('#cSugestao').innerHTML = sugestao;
    $('#cVariacao').innerHTML = prod ? (htmlVariacao(compararCusto(prod, custo), prod, margem) ||
      (custo > 0 && Math.abs(custo - prod.custo) < 0.005 ? `<div class="variacao igual">Mesmo custo da última compra (${brl(prod.custo)} em ${data(prod.atualizado)})</div>` : '')) : '';
    if (modoManual) $('#cComparacao').innerHTML = htmlComparacao(custo, preco, num(cManual.value), margem);
  }

  cCusto.addEventListener('input', recalcular);
  cMargem.addEventListener('input', recalcular);
  cManual.addEventListener('input', recalcular);
  cCat.addEventListener('change', () => { cMargem.value = fmtNum(margemDaCategoria(cCat.value), 0); recalcular(); });
  cNome.addEventListener('input', recalcular);
  // pointerdown: dispara antes do campo perder o foco (que redesenharia o botão)
  $('#cSugestao').addEventListener('pointerdown', e => {
    const b = e.target.closest('#cUsarSugestao'); if (!b) return;
    e.preventDefault();
    cNome.value = b.dataset.nome;
    cNome.dispatchEvent(new Event('change'));
  });
  cNome.addEventListener('change', () => {
    const p = produtoPorNome(cNome.value);
    if (p) {
      cCusto.value = '';
      cCusto.placeholder = 'Último custo: ' + fmtNum(p.custo);
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
    const v = prod.variacaoAgora;
    if (usarManual) {
      const r = registrarAjuste(prod, Math.round(manualV * 100) / 100);
      aviso(`Salvo com ajuste manual (${sinal(r.diferenca)}${brl(Math.abs(r.diferenca))})` + (v ? ' · custo ' + textoVariacao(v).replace('Aumentou', 'aumentou').replace('Baixou', 'baixou') : ''));
    } else {
      aviso('Produto salvo: ' + brl(prod.precoFinal) + (v ? ' · custo ' + textoVariacao(v).replace('Aumentou', 'aumentou').replace('Baixou', 'baixou') : ''));
    }
    salvar();
    limparCalcular();
  });

  function limparCalcular() {
    cNome.value = ''; cCusto.value = ''; cManual.value = ''; cCusto.placeholder = '0,00';
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
          <div class="nome">${esc(p.nome)} ${p.manual ? '<span class="tag manual">manual</span>' : ''}
            ${p.ultimaVariacao ? `<span class="tag ${p.ultimaVariacao.diferenca > 0 ? 'sobe' : 'desce'}" title="Última mudança de custo">${p.ultimaVariacao.diferenca > 0 ? '▲' : '▼'} ${pct(Math.abs(p.ultimaVariacao.diferencaPct))}</span>` : ''}</div>
          <div class="meta">Custo ${brl(p.custo)} · ${esc(categoria(p.categoriaId).nome)} · ${pct(p.margem)}
            ${p.manual ? ` · calculado ${brl(calcularPreco(p.custo, p.margem))} · lucro real ${pct(margemReal(p.custo, p.precoFinal))}` : ''}
            · ${data(p.atualizado)}</div>
          ${p.apelidos && p.apelidos.length ? `<div class="meta">Também aparece como: ${p.apelidos.map(esc).join(' · ')}</div>` : ''}
          ${p.ean ? `<div class="meta">Código de barras: ${esc(p.ean)}</div>` : ''}
          ${p.custos && p.custos.length > 1 ? `<details class="custos"><summary>Histórico de custo (${p.custos.length} compras)</summary>
            ${p.custos.slice().reverse().map((c, i, arr) => {
              const ant = arr[i + 1];
              const d = ant ? (c.custo - ant.custo) / ant.custo * 100 : null;
              return `<div>${data(c.data)} — <b>${brl(c.custo)}</b>${d != null ? ` <span class="${d > 0 ? 'neg' : 'pos'}">${sinal(d)}${pct(Math.abs(d))}</span>` : ''}</div>`;
            }).join('')}
            <div class="meta">Desde a 1ª compra: ${(() => { const a = p.custos[0].custo, z = p.custos[p.custos.length - 1].custo, d = (z - a) / a * 100; return `${sinal(d)}${pct(Math.abs(d))} (${brl(a)} → ${brl(z)})`; })()}</div>
          </details>` : ''}
        </div>
        <div class="preco">${brl(p.precoFinal)}</div>
        <div class="acoes">
          <button class="btn-mini" data-acao="manual">Ajustar preço</button>
          <button class="btn-mini" data-acao="editar">Editar / recalcular</button>
          <button class="btn-mini" data-acao="renomear">Renomear</button>
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
    } else if (acao === 'renomear') {
      const novo = prompt('Nome do produto (é assim que aparece na lista do WhatsApp):', p.nome);
      if (novo && novo.trim() && novo.trim() !== p.nome) {
        if (!(p.apelidos || []).some(a => normalizar(a) === normalizar(p.nome))) (p.apelidos = p.apelidos || []).push(p.nome);
        p.nome = novo.trim(); salvar(); renderProdutos(); aviso('Nome atualizado');
      }
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

  function renderVariacoes() {
    const q = normalizar($('#vBusca').value);
    const filtro = $('#vFiltro').value;
    const lista = db.variacoes.filter(v => (!q || normalizar(v.nome).includes(q)) &&
      (filtro === 'todos' || (filtro === 'sobe' ? v.diferenca > 0 : v.diferenca < 0)));
    const el = $('#vLista');
    const sobe = db.variacoes.filter(v => v.diferenca > 0);
    const desce = db.variacoes.filter(v => v.diferenca < 0);
    const media = arr => arr.length ? arr.reduce((s, v) => s + v.diferencaPct, 0) / arr.length : 0;
    $('#vResumo').innerHTML = db.variacoes.length ? `
      <div class="resumo"><div class="nome">Aumentos</div><div class="grande neg">${sobe.length}</div><div class="meta">média ${pct(media(sobe))}</div></div>
      <div class="resumo"><div class="nome">Reduções</div><div class="grande pos">${desce.length}</div><div class="meta">média ${pct(Math.abs(media(desce)))}</div></div>` : '';
    if (!lista.length) { el.innerHTML = '<div class="vazio">Quando um produto já salvo for comprado de novo com outro custo, aparece aqui.</div>'; return; }
    el.innerHTML = lista.map(v => `<div class="item">
      <div>
        <div class="nome">${esc(v.nome)}</div>
        <div class="meta">${data(v.data)} · custo ${brl(v.custoAnterior)} (${data(v.dataAnterior)}) → <b>${brl(v.custoNovo)}</b></div>
        <div class="meta">Venda: ${brl(v.precoVendaAnterior)} → ${brl(v.precoVendaNovo)}</div>
      </div>
      <div class="preco ${v.diferenca > 0 ? 'neg' : 'pos'}">${v.diferenca > 0 ? '▲' : '▼'} ${pct(Math.abs(v.diferencaPct))}<div class="meta">${sinal(v.diferenca)}${brl(Math.abs(v.diferenca))}</div></div>
    </div>`).join('');
  }
  $('#vBusca').addEventListener('input', renderVariacoes);
  $('#vFiltro').addEventListener('change', renderVariacoes);
  $('#vExportar').addEventListener('click', () => {
    const f = v => fmtNum(v);
    const col = ['Data', 'Produto', 'Custo anterior', 'Data anterior', 'Custo novo', 'Diferença R$', 'Diferença %', 'Venda anterior', 'Venda nova'];
    const linhas = db.variacoes.map(v => [data(v.data), v.nome, f(v.custoAnterior), data(v.dataAnterior), f(v.custoNovo), f(v.diferenca), f(v.diferencaPct), f(v.precoVendaAnterior), f(v.precoVendaNovo)]);
    const csv = [col, ...linhas].map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    baixar('variacao-custos.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  });
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
  // ---------------------------------------------------------------- LISTA PARA WHATSAPP
  let idsUltimaNota = [];
  function produtosDaLista() {
    const filtro = $('#lFiltro').value;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const semana = Date.now() - 7 * 864e5;
    return db.produtos.filter(p => {
      if (filtro === 'nota') return idsUltimaNota.includes(p.id);
      if (filtro === 'hoje') return new Date(p.atualizado) >= hoje;
      if (filtro === 'semana') return new Date(p.atualizado).getTime() >= semana;
      return true;
    });
  }
  function nomeLista(p) { return window.Reconhecer.nomeAmigavel(p.nome); }
  function textoLista() {
    const lista = produtosDaLista().filter(p => p.precoFinal > 0);
    const linha = p => `• ${nomeLista(p)} — *${brl(p.precoFinal)}${p.porKg ? '/kg' : ''}*`;
    const ordenar = arr => arr.slice().sort((a, b) => nomeLista(a).localeCompare(nomeLista(b), 'pt-BR'));
    let corpo;
    if ($('#lPorRamo').checked) {
      corpo = db.categorias.map(c => {
        const itens = ordenar(lista.filter(p => p.categoriaId === c.id));
        return itens.length ? `*${c.nome.toUpperCase()}*\n${itens.map(linha).join('\n')}` : '';
      }).filter(Boolean);
      const semRamo = ordenar(lista.filter(p => !db.categorias.some(c => c.id === p.categoriaId)));
      if (semRamo.length) corpo.push(semRamo.map(linha).join('\n'));
      corpo = corpo.join('\n\n');
    } else {
      corpo = ordenar(lista).map(linha).join('\n');
    }
    const titulo = $('#lTitulo').value.trim();
    const cab = titulo ? `*${titulo}*\n${$('#lPorRamo').checked ? '\n' : ''}` : '';
    return { texto: `${cab}${corpo}`, qtd: lista.length };
  }
  function atualizarLista() {
    const { texto, qtd } = textoLista();
    $('#lTexto').value = qtd ? texto : '';
    $('#lQtd').textContent = qtd ? `${qtd} produto(s) — dá para editar o texto antes de enviar` : 'Nenhum produto neste filtro.';
  }
  function abrirListaWhats(ids) {
    if (ids && ids.length) idsUltimaNota = ids;
    const optNota = $('#lFiltro option[value=nota]');
    optNota.disabled = !idsUltimaNota.length;
    $('#lFiltro').value = ids && ids.length ? 'nota' : (idsUltimaNota.length ? 'nota' : 'hoje');
    $('#lTitulo').value = db.config.tituloLista || `Preços ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
    atualizarLista();
    $('#modalLista').showModal();
  }
  ['#lFiltro', '#lPorRamo'].forEach(s => $(s).addEventListener('change', atualizarLista));
  $('#lTitulo').addEventListener('input', atualizarLista);
  $('#lTitulo').addEventListener('change', e => {
    // guarda o título se não for o padrão com data
    if (!/^Preços \d{2}\/\d{2}$/.test(e.target.value.trim())) { db.config.tituloLista = e.target.value.trim(); salvar(); }
  });
  $('#lEnviar').addEventListener('click', async () => {
    const texto = $('#lTexto').value.trim();
    if (!texto) { aviso('A lista está vazia'); return; }
    if (navigator.share) {
      try { await navigator.share({ text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
  });
  $('#lCopiar').addEventListener('click', async () => {
    const t = $('#lTexto');
    try { await navigator.clipboard.writeText(t.value); }
    catch (e) { t.select(); document.execCommand('copy'); }
    aviso('Lista copiada — é só colar no WhatsApp');
  });
  $('#pWhats').addEventListener('click', () => abrirListaWhats());

  window.App = {
    get db() { return db; },
    num, brl, pct, fmtNum, esc, normalizar, aviso,
    calcularPreco, margemDaCategoria, opcoesCategorias, categoria,
    salvarProduto, registrarAjuste, pedirPrecoManual, salvar,
    compararCusto, produtoPorNome, textoVariacao, encontrarParecidos, RECONHECER_AUTO, abrirListaWhats
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
