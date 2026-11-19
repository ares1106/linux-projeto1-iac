/* Leitura de nota fiscal: XML da NF-e, foto (OCR no aparelho) ou Claude (foto/PDF) */
import { parseTextoNota, parseXmlNfe } from './parser.js';

const App = window.App;
const $ = s => document.querySelector(s);
const { num, brl, fmtNum, esc } = App;

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm';

let itens = []; // linhas da tabela

// ------------------------------------------------------------------ status
function status(msg, erro = false) {
  const el = $('#nStatus');
  el.classList.toggle('oculto', !msg);
  el.classList.toggle('erro', erro);
  el.textContent = msg || '';
}

// ------------------------------------------------------------------ entrada de arquivo
$('#nFoto').addEventListener('change', e => processarArquivo(e.target.files[0], e.target));
$('#nArquivo').addEventListener('change', e => processarArquivo(e.target.files[0], e.target));

async function processarArquivo(arquivo, input) {
  if (!arquivo) return;
  input.value = '';
  $('#nTexto').textContent = '';
  const ehXml = /xml/i.test(arquivo.type) || /\.xml$/i.test(arquivo.name);
  const ehPdf = arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name);
  const metodo = document.querySelector('input[name=metodo]:checked').value;

  const previa = $('#nPrevia');
  if (!ehXml && !ehPdf) { previa.src = URL.createObjectURL(arquivo); previa.classList.remove('oculto'); }
  else previa.classList.add('oculto');

  try {
    let lidos;
    if (ehXml) {
      status('Lendo XML da nota…');
      lidos = parseXmlNfe(await arquivo.text());
      $('#nTexto').textContent = '(arquivo XML — valores exatos da nota)';
    } else if (metodo === 'claude' || ehPdf) {
      if (!App.db.config.apiKey) {
        status(ehPdf ? 'Para ler PDF é preciso a chave de API do Claude (aba Ajustes).' : 'Cole a chave de API do Claude na aba Ajustes, ou escolha "Leitura no aparelho".', true);
        return;
      }
      status('Enviando para o Claude ler a nota… (pode levar até 1 minuto)');
      lidos = await lerComClaude(arquivo, ehPdf);
    } else {
      lidos = await lerComOcr(arquivo);
    }
    if (!lidos.length) {
      status('Não encontrei itens com preço. Tente uma foto mais reta e nítida, ou adicione as linhas manualmente.', true);
    } else {
      status(`${lidos.length} item(ns) encontrados. Confira os valores antes de salvar.`);
    }
    montarItens(lidos);
  } catch (err) {
    console.error(err);
    status('Erro ao ler a nota: ' + (err.message || err), true);
  }
}

// ------------------------------------------------------------------ OCR no aparelho (Tesseract)
async function reduzirImagem(arquivo, maxLado, tipo = 'image/jpeg', qualidade = 0.88, cinza = false) {
  const bmp = await createImageBitmap(arquivo);
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
  const ctx = c.getContext('2d');
  if (cinza) ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, tipo, qualidade));
}

async function lerComOcr(arquivo) {
  status('Carregando leitor de texto (na primeira vez baixa ~15 MB)…');
  const { createWorker } = await import(TESSERACT_URL);
  const worker = await createWorker('por', 1, {
    logger: m => {
      if (m.status === 'recognizing text') status(`Lendo a nota… ${Math.round(m.progress * 100)}%`);
    }
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const img = await reduzirImagem(arquivo, 2400, 'image/png', 1, true);
    const { data } = await worker.recognize(img);
    $('#nTexto').textContent = data.text;
    return parseTextoNota(data.text);
  } finally {
    await worker.terminate();
  }
}

// ------------------------------------------------------------------ Claude (foto ou PDF)
const ESQUEMA_ITENS = {
  type: 'object',
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          descricao: { type: 'string', description: 'Descrição do produto como está na nota' },
          quantidade: { type: 'number' },
          unidade: { type: 'string', description: 'UN, CX, FD, KG, PCT...' },
          valor_unitario: { type: 'number', description: 'Valor unitário em reais, como na nota' },
          valor_total: { type: 'number', description: 'Valor total do item em reais' },
          codigo_barras: { type: 'string', description: 'Código de barras (EAN/GTIN) do item se estiver impresso na nota; vazio se não houver' },
          unidades_por_embalagem: { type: 'number', description: 'Quantas unidades vêm dentro de cada caixa/fardo/pacote, se a descrição indicar (ex.: CX12, 12X1L, FD 6UN). 1 se não houver.' }
        },
        required: ['descricao', 'quantidade', 'unidade', 'valor_unitario', 'valor_total', 'codigo_barras', 'unidades_por_embalagem'],
        additionalProperties: false
      }
    }
  },
  required: ['itens'],
  additionalProperties: false
};

function paraBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

async function lerComClaude(arquivo, ehPdf) {
  const { default: Anthropic } = await import(ANTHROPIC_SDK_URL);
  const client = new Anthropic({ apiKey: App.db.config.apiKey, dangerouslyAllowBrowser: true });

  const anexo = ehPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await paraBase64(arquivo) } }
    : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await paraBase64(await reduzirImagem(arquivo, 2000)) } };

  let resp;
  try {
    resp = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA_ITENS } },
      messages: [{
        role: 'user',
        content: [
          anexo,
          {
            type: 'text',
            text: 'Esta é uma nota fiscal de compra de mercadorias (NF-e/DANFE, NFC-e ou cupom) de um mercado. ' +
              'Liste TODOS os itens/produtos da nota, na ordem em que aparecem, com quantidade, unidade, valor unitário e valor total. ' +
              'Use os números exatamente como impressos (em reais, ponto como separador decimal no JSON). ' +
              'Não inclua linhas de totais, impostos, frete, descontos gerais ou formas de pagamento. ' +
              'Se um valor estiver ilegível, estime pelo total ÷ quantidade.'
          }
        ]
      }]
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('chave de API inválida (confira na aba Ajustes)');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('a chave não tem permissão para usar este modelo');
    if (err instanceof Anthropic.RateLimitError) throw new Error('muitas leituras seguidas ou sem créditos — aguarde um pouco');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('sem conexão com a internet');
    if (err instanceof Anthropic.APIError) throw new Error(`serviço respondeu ${err.status}: ${err.message}`);
    throw err;
  }

  if (resp.stop_reason === 'refusal') throw new Error('o Claude não conseguiu processar esta imagem');
  if (resp.stop_reason === 'max_tokens') throw new Error('a nota é grande demais para uma leitura; tente fotografar em partes');
  const texto = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const dados = JSON.parse(texto);
  $('#nTexto').textContent = dados.itens.map(i =>
    `${i.descricao} | ${i.quantidade} ${i.unidade} x ${i.valor_unitario} = ${i.valor_total}`).join('\n');
  return dados.itens.map(i => ({
    descricao: i.descricao,
    quantidade: i.quantidade,
    unidade: i.unidade,
    valorUnitario: i.valor_unitario || (i.quantidade ? i.valor_total / i.quantidade : 0),
    unPorEmb: i.unidades_por_embalagem > 0 ? i.unidades_por_embalagem : 1,
    ean: /^\d{8,14}$/.test(i.codigo_barras || '') && window.Reconhecer.gtinValido(i.codigo_barras) ? i.codigo_barras : '',
    confiavel: true
  }));
}

// ------------------------------------------------------------------ tabela de conferência
function categoriaPadrao() { return App.db.categorias[0].id; }

function montarItens(lidos) {
  const cat = $('#nCategoriaTodos').value || categoriaPadrao();
  itens = lidos.map(l => {
    const it = { nome: l.descricao, ean: l.ean || '' };
    reconhecer(it);
    // Se reconheceu o produto, reaproveita ramo e %
    const existente = vinculado(it);
    const categoriaId = existente ? existente.categoriaId : cat;
    return {
      ...it,
      marcado: l.confiavel !== false,
      custoEmb: Math.round(l.valorUnitario * 100) / 100,
      unPorEmb: l.unPorEmb || 1,
      categoriaId,
      margem: existente ? existente.margem : App.margemDaCategoria(categoriaId),
      precoManual: null
    };
  });
  renderTabela();
}

/** Procura produtos já salvos parecidos com o item da nota */
function reconhecer(it) {
  it.candidatos = App.encontrarParecidos(it.nome, it.ean);
  const melhor = it.candidatos[0];
  it.vinculo = melhor && melhor.score >= App.RECONHECER_AUTO ? melhor.prod.id : '';
}
const vinculado = it => (it.vinculo ? App.db.produtos.find(p => p.id === it.vinculo) : null);

const custoUn = it => (it.unPorEmb > 0 ? it.custoEmb / it.unPorEmb : it.custoEmb);

function celulaVariacao(it) {
  const prod = vinculado(it);
  const opcoes = ['<option value="">➕ produto novo</option>'].concat((it.candidatos || []).map(c =>
    `<option value="${esc(c.prod.id)}"${c.prod.id === it.vinculo ? ' selected' : ''}>${esc(c.prod.nome)} (${Math.round(c.score * 100)}%)</option>`));
  const sel = `<select data-c="vinculo" class="vinculo">${opcoes.join('')}</select>`;
  let info;
  if (!prod) info = `<div class="var novo">${it.candidatos && it.candidatos.length ? 'parecidos na lista ↑ — escolha se for o mesmo' : 'não encontrado nos salvos'}</div>`;
  else {
    const v = App.compararCusto(prod, custoUn(it));
    if (!v) info = `<div class="var igual">= mesmo custo (${brl(prod.custo)})</div>`;
    else {
      const sobe = v.diferenca > 0;
      info = `<div class="var ${sobe ? 'sobe' : 'desce'}">${sobe ? '▲' : '▼'} ${App.pct(Math.abs(v.diferencaPct))} (${sobe ? '+' : '−'}${brl(Math.abs(v.diferenca))}) · antes ${brl(v.custoAnterior)}</div>`;
    }
  }
  return `<td class="cel-vinculo">${sel}${info}</td>`;
}

function resumoVariacoes() {
  let sobe = 0, desce = 0, novos = 0, maior = null;
  itens.forEach(it => {
    if (!it.marcado) return;
    const prod = vinculado(it);
    if (!prod) { novos++; return; }
    const v = App.compararCusto(prod, custoUn(it));
    if (!v) return;
    if (v.diferenca > 0) { sobe++; if (!maior || v.diferencaPct > maior.pct) maior = { nome: it.nome, pct: v.diferencaPct }; }
    else desce++;
  });
  const el = $('#nResumoVar');
  if (!sobe && !desce) { el.innerHTML = novos ? `<div class="variacao igual">${novos} produto(s) novo(s), nenhum aumento em relação às compras anteriores.</div>` : ''; return; }
  el.innerHTML = `<div class="variacao ${sobe ? 'sobe' : 'desce'}">
    ${sobe ? `<b>▲ ${sobe} produto(s) com aumento de custo</b>${maior ? ` — maior: ${esc(maior.nome)} (+${App.pct(maior.pct)})` : ''}<br>` : ''}
    ${desce ? `▼ ${desce} produto(s) ficaram mais baratos<br>` : ''}
    ${novos ? `${novos} produto(s) novo(s)` : ''}</div>`;
}

function renderTabela() {
  $('#nResultado').classList.remove('oculto');
  resumoVariacoes();
  $('#nCategoriaTodos').innerHTML = App.opcoesCategorias($('#nCategoriaTodos').value || categoriaPadrao());
  $('#nTabela tbody').innerHTML = itens.map((it, i) => {
    const calc = App.calcularPreco(custoUn(it), it.margem);
    const venda = it.precoManual ?? calc;
    return `<tr data-i="${i}" class="${it.marcado ? '' : 'desmarcado'}">
      <td><input type="checkbox" data-c="marcado" ${it.marcado ? 'checked' : ''}></td>
      <td><input type="text" data-c="nome" value="${esc(it.nome)}"></td>
      <td><input type="text" class="num" data-c="custoEmb" inputmode="decimal" value="${fmtNum(it.custoEmb)}"></td>
      <td><input type="text" class="peq" data-c="unPorEmb" inputmode="numeric" value="${it.unPorEmb}"></td>
      <td class="custo-un">${brl(custoUn(it))}</td>
      <td><select data-c="categoriaId">${App.opcoesCategorias(it.categoriaId)}</select></td>
      <td><input type="text" class="peq" data-c="margem" inputmode="decimal" value="${fmtNum(it.margem, 0)}"></td>
      <td class="venda ${it.precoManual != null ? 'manual' : ''}" title="${it.precoManual != null ? 'Preço manual (calculado ' + brl(calc) + ')' : ''}">${brl(venda)}</td>
      ${celulaVariacao(it)}
      <td><button class="btn-mini" data-acao="manual">Ajustar</button> <button class="btn-mini" data-acao="remover" title="Remover linha">✕</button></td>
    </tr>`;
  }).join('');
}

$('#nTabela').addEventListener('change', e => {
  const tr = e.target.closest('tr[data-i]'); if (!tr) return;
  const it = itens[tr.dataset.i]; const c = e.target.dataset.c;
  if (c === 'marcado') it.marcado = e.target.checked;
  else if (c === 'nome') { it.nome = e.target.value; reconhecer(it); }
  else if (c === 'vinculo') {
    it.vinculo = e.target.value;
    const p = vinculado(it);
    if (p) { it.categoriaId = p.categoriaId; it.margem = p.margem; it.precoManual = null; }
  }
  else if (c === 'custoEmb') { const v = num(e.target.value); if (v >= 0) it.custoEmb = v; it.precoManual = null; }
  else if (c === 'unPorEmb') { const v = num(e.target.value); if (v > 0) it.unPorEmb = v; it.precoManual = null; }
  else if (c === 'margem') { const v = num(e.target.value); if (isFinite(v)) it.margem = v; it.precoManual = null; }
  else if (c === 'categoriaId') { it.categoriaId = e.target.value; it.margem = App.margemDaCategoria(it.categoriaId); it.precoManual = null; }
  renderTabela();
});

$('#nTabela').addEventListener('click', async e => {
  const b = e.target.closest('button[data-acao]'); if (!b) return;
  const i = Number(b.closest('tr').dataset.i); const it = itens[i];
  if (b.dataset.acao === 'remover') { itens.splice(i, 1); renderTabela(); return; }
  const v = await App.pedirPrecoManual({ nome: it.nome, custo: custoUn(it), margem: it.margem, precoAtual: it.precoManual });
  if (v != null) { it.precoManual = v; it.marcado = true; renderTabela(); }
});

$('#nAplicarCat').addEventListener('click', () => {
  const cat = $('#nCategoriaTodos').value;
  itens.forEach(it => { if (it.marcado) { it.categoriaId = cat; it.margem = App.margemDaCategoria(cat); it.precoManual = null; } });
  renderTabela();
});

$('#nAdicionarLinha').addEventListener('click', () => {
  const cat = $('#nCategoriaTodos').value || categoriaPadrao();
  itens.push({ marcado: true, nome: '', ean: '', vinculo: '', candidatos: [], custoEmb: 0, unPorEmb: 1, categoriaId: cat, margem: App.margemDaCategoria(cat), precoManual: null });
  renderTabela();
  const ult = $('#nTabela tbody tr:last-child input[data-c=nome]'); if (ult) ult.focus();
});

$('#nSalvarTodos').addEventListener('click', () => {
  const sel = itens.filter(it => it.marcado && custoUn(it) > 0);
  if (!sel.length) { App.aviso('Nenhum item marcado com custo válido'); return; }
  let ajustes = 0, aumentos = 0;
  sel.forEach(it => {
    const prod = App.salvarProduto({ nome: it.nome, produtoId: it.vinculo || null, ean: it.ean, custo: Math.round(custoUn(it) * 10000) / 10000, categoriaId: it.categoriaId, margem: it.margem });
    if (prod.variacaoAgora && prod.variacaoAgora.diferenca > 0) aumentos++;
    if (it.precoManual != null) { App.registrarAjuste(prod, it.precoManual); ajustes++; }
  });
  App.salvar();
  itens = itens.filter(it => !sel.includes(it));
  renderTabela();
  if (!itens.length) $('#nResultado').classList.add('oculto');
  App.aviso(`${sel.length} produto(s) salvos${ajustes ? `, ${ajustes} com ajuste manual` : ''}${aumentos ? ` · ${aumentos} aumento(s) de custo no Histórico` : ''}`);
});
