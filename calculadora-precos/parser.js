/* Interpretação do texto/XML de notas fiscais. Funções puras (testáveis). */

const IGNORAR = /\b(sub\s*total|total|desconto|acr[eé]scimo|troco|cnpj|cpf|valor\s+a\s+pagar|valor\s+pago|dinheiro|cart[aã]o|cr[eé]dito|d[eé]bito|pix|tributos?|icms|base\s+de\s+c|frete|seguro|chave\s+de\s+acesso|protocolo|inscri[cç][aã]o|endere[cç]o|emiss[aã]o|fatura|duplicata|vencimento|qtd\.?\s*total|forma\s+de\s+pagamento|lei\s+\d|consumidor)\b/i;
// Unidade da nota; o Atacadão imprime com um dígito colado (UND9, CXA2, PCT9, EMB3)
const UNIDADES = /^(un|und|unid|uni|cx|cxa|fd|fdo|pct|pc|pç|pca|pt|kg|g|gr|lt|l|ml|dz|sc|bd|gf|frd|lat|cj|par|m|mt|emb)\.?\d?$/i;
const UNIDADES_EMB = /^(cx|cxa|fd|fdo|frd|pct|pt|dz|sc|bd|cj|emb)\.?\d?$/i;
// "desconto sobre item" (Atacadão e outros): o desconto vale para o item da linha de cima
const LINHA_DESCONTO_ITEM = /desc(onto)?\.?\s*(s[oóô0]bre|s\/|no|do)?\s*[il1]tem/i;
const limparUnidade = u => (u || '').replace(/[.\d]+$/, '').toUpperCase();

/** custo unitário = (valor total − desconto do item) ÷ quantidade */
export function aplicarDesconto(item, desconto) {
  if (!(desconto > 0) || !(item.total > 0) || desconto >= item.total) return false;
  item.desconto = Math.round(((item.desconto || 0) + desconto) * 100) / 100;
  item.valorUnitario = (item.total - item.desconto) / (item.quantidade || 1);
  return true;
}

/** Converte um número no formato brasileiro (ou com ponto decimal) */
export function numeroBr(s) {
  s = String(s).trim();
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+\.\d{2}$/.test(s)) return parseFloat(s);
  return parseFloat(s.replace(/\./g, ''));
}

function tokensNumericos(linha) {
  const out = [];
  const re = /\d[\d.]*(?:,\d+)?/g;
  let m;
  while ((m = re.exec(linha))) {
    const txt = m[0].replace(/\.$/, '');
    const decimal = /,\d+$/.test(txt) || /^\d+\.\d{2}$/.test(txt);
    out.push({ txt, valor: numeroBr(txt), pos: m.index, fim: m.index + txt.length, decimal });
  }
  return out;
}

const gtinOk = c => (globalThis.Reconhecer ? globalThis.Reconhecer.gtinValido(c) : true);
const perto = (a, b) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.015);

/** Procura, na ordem da linha, quantidade × unitário = total */
function acharTrio(nums) {
  const dinheiro = nums.map((n, i) => ({ ...n, i })).filter(n => n.decimal);
  // 1) tokens vizinhos: qtd, unit, total
  for (let k = 2; k < nums.length; k++) {
    const q = nums[k - 2], u = nums[k - 1], t = nums[k];
    if (u.decimal && t.decimal && q.valor > 0 && q.valor < 10000 && perto(q.valor * u.valor, t.valor)) return { q, u, t };
  }
  // 2) quaisquer posições (há colunas no meio, ex.: "UN")
  for (let a = 0; a < dinheiro.length; a++) {
    for (let b = a + 1; b < dinheiro.length; b++) {
      const u = dinheiro[a], t = dinheiro[b];
      for (let c = u.i - 1; c >= 0; c--) {
        const q = nums[c];
        if (q.valor > 0 && q.valor < 10000 && !(q.txt.length >= 6 && !q.decimal) && perto(q.valor * u.valor, t.valor)) return { q, u, t };
      }
    }
  }
  // 3) unitário = total (quantidade 1 implícita)
  for (let a = 0; a + 1 < dinheiro.length; a++) {
    if (dinheiro[a].valor > 0 && perto(dinheiro[a].valor, dinheiro[a + 1].valor)) {
      return { q: null, u: dinheiro[a], t: dinheiro[a + 1] };
    }
  }
  return null;
}

function limparDescricao(trecho) {
  let toks = trecho.replace(/[|*#]/g, ' ').split(/\s+/).filter(Boolean);
  const ehCodigo = t => /^\d[\d.\-/]*$/.test(t) || /^[A-Z]{1,4}\d{4,}$/i.test(t) || (t.length >= 6 && t.replace(/\D/g, '').length / t.length >= 0.8);
  while (toks.length && ehCodigo(toks[0])) toks.shift();
  while (toks.length && (ehCodigo(toks[toks.length - 1]) || UNIDADES.test(toks[toks.length - 1]) || /^x$/i.test(toks[toks.length - 1]))) toks.pop();
  return toks.join(' ').replace(/^[\s\-–.:]+|[\s\-–.:]+$/g, '');
}

/** Detecta "CX 12", "C/12", "12X1L", "FD6" na descrição */
export function unidadesPorEmbalagem(descricao) {
  const d = descricao.toUpperCase();
  let m = d.match(/\b(?:CX|CXA|FD|FDO|PCT|PC|C\/|COM)\s*(\d{1,3})\s*(?:UN|UND|UNID)?\b/);
  if (m) return Number(m[1]);
  m = d.match(/\b(\d{1,3})\s*X\s*\d+[.,]?\d*\s*(?:ML|L|G|GR|KG|UN)\b/);
  if (m) return Number(m[1]);
  m = d.match(/\b(\d{1,3})\s*(?:UN|UND|UNID)\b/);
  if (m) return Number(m[1]);
  return 1;
}

/**
 * Lê o texto de uma nota (OCR) e devolve itens:
 * { descricao, quantidade, unidade, valorUnitario, unPorEmb, confiavel }
 */
export function parseTextoNota(texto) {
  const itens = [];
  let descontoPendente = false;
  for (let linha of texto.split(/\r?\n/)) {
    linha = linha.replace(/\s+/g, ' ').trim();
    if (!linha) continue;
    // Linha "desconto sobre item 5,40": desconta do item anterior
    if (LINHA_DESCONTO_ITEM.test(linha)) {
      const vals = tokensNumericos(linha).filter(n => n.decimal);
      const ult = itens[itens.length - 1];
      if (vals.length && ult) { aplicarDesconto(ult, vals[vals.length - 1].valor); descontoPendente = false; }
      else descontoPendente = !!ult;
      continue;
    }
    // Valor do desconto sozinho na linha de baixo
    if (descontoPendente && /^[-−R$\s]*\d+[.,]\d{2}$/.test(linha)) {
      aplicarDesconto(itens[itens.length - 1], numeroBr(linha.replace(/[^\d.,]/g, '')));
      descontoPendente = false;
      continue;
    }
    descontoPendente = false;
    if (linha.length < 6) continue;
    if ((linha.match(/[A-Za-zÀ-ÿ]/g) || []).length < 3) continue;
    if (IGNORAR.test(linha)) continue;

    const nums = tokensNumericos(linha);
    if (!nums.some(n => n.decimal)) continue;

    const trio = acharTrio(nums);
    let descricao, quantidade, valorUnitario, confiavel, inicioNumeros, unidade = '', total;
    if (trio) {
      quantidade = trio.q ? trio.q.valor : 1;
      valorUnitario = trio.u.valor;
      total = trio.t.valor;
      confiavel = true;
      inicioNumeros = trio.q ? trio.q.pos : trio.u.pos;
    } else {
      const dinheiro = nums.filter(n => n.decimal);
      const ult = dinheiro[dinheiro.length - 1];
      quantidade = 1;
      valorUnitario = ult.valor;
      total = ult.valor;
      confiavel = false;
      inicioNumeros = dinheiro[0].pos;
    }
    // A descrição termina antes do primeiro número que não seja código de produto
    const antes = linha.slice(0, inicioNumeros);
    descricao = limparDescricao(antes);
    if (!descricao || !/[A-Za-zÀ-ÿ]{2}/.test(descricao)) continue;
    if (!(valorUnitario > 0)) continue;

    // Unidade: palavra entre a descrição e os números, ou logo após a quantidade
    const um = linha.slice(0, (trio ? trio.u.pos : inicioNumeros)).split(/\s+/).reverse().find(t => UNIDADES.test(t));
    if (um) unidade = limparUnidade(um);

    const unPorEmb = UNIDADES_EMB.test(unidade) ? unidadesPorEmbalagem(descricao) : 1;
    const ean = nums.map(n => n.txt).find(t => /^\d{12,14}$/.test(t) && gtinOk(t)) || '';
    itens.push({ descricao, quantidade, unidade, valorUnitario, total, desconto: 0, unPorEmb, confiavel, ean });
  }
  return itens;
}

/** Lê o XML de uma NF-e/NFC-e (valores exatos) */
export function parseXmlNfe(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido');
  const pega = (el, tag) => { const n = el.getElementsByTagNameNS('*', tag)[0] || el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
  let dets = [...doc.getElementsByTagNameNS('*', 'det')];
  if (!dets.length) dets = [...doc.getElementsByTagName('det')];
  if (!dets.length) throw new Error('não encontrei itens (<det>) no XML — é mesmo uma NF-e?');
  return dets.map(det => {
    const descricao = pega(det, 'xProd');
    const unidade = limparUnidade(pega(det, 'uCom'));
    const quantidade = parseFloat(pega(det, 'qCom')) || 1;
    const vProd = parseFloat(pega(det, 'vProd')) || 0;
    const vDesc = parseFloat(pega(det, 'vDesc')) || 0;
    // custo real = (valor do produto − desconto do item) ÷ quantidade
    const valorUnitario = (vProd - vDesc) / quantidade || parseFloat(pega(det, 'vUnCom')) || 0;
    const desconto = vDesc;
    const unPorEmb = UNIDADES_EMB.test(unidade) ? unidadesPorEmbalagem(descricao) : 1;
    const ean = [pega(det, 'cEAN'), pega(det, 'cEANTrib')].find(c => /^\d{8,14}$/.test(c) && gtinOk(c)) || '';
    return { descricao, quantidade, unidade, valorUnitario, total: vProd, desconto, unPorEmb, confiavel: true, ean };
  });
}

/** Converte a resposta do Claude em itens, aplicando o desconto de cada item no custo */
export function itensDoClaude(dados) {
  return (dados.itens || []).map(i => {
    const quantidade = i.quantidade > 0 ? i.quantidade : 1;
    const total = i.valor_total > 0 ? i.valor_total : (i.valor_unitario || 0) * quantidade;
    const item = {
      descricao: i.descricao,
      quantidade,
      unidade: limparUnidade(i.unidade),
      valorUnitario: total / quantidade || i.valor_unitario || 0,
      total,
      desconto: 0,
      unPorEmb: i.unidades_por_embalagem > 0 ? i.unidades_por_embalagem : 1,
      ean: /^\d{8,14}$/.test(i.codigo_barras || '') && gtinOk(i.codigo_barras) ? i.codigo_barras : '',
      confiavel: true
    };
    aplicarDesconto(item, i.desconto);
    return item;
  });
}
