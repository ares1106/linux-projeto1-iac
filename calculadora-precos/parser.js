/* Interpretação do texto/XML de notas fiscais. Funções puras (testáveis). */

const IGNORAR = /\b(sub\s*total|total|desconto|acr[eé]scimo|troco|cnpj|cpf|valor\s+a\s+pagar|valor\s+pago|dinheiro|cart[aã]o|cr[eé]dito|d[eé]bito|pix|tributos?|icms|base\s+de\s+c|frete|seguro|chave\s+de\s+acesso|protocolo|inscri[cç][aã]o|endere[cç]o|emiss[aã]o|fatura|duplicata|vencimento|qtd\.?\s*total|forma\s+de\s+pagamento|lei\s+\d|consumidor)\b/i;
const UNIDADES = /^(un|und|unid|uni|cx|cxa|fd|fdo|pct|pc|pç|pt|kg|g|gr|lt|l|ml|dz|sc|bd|gf|frd|lat|cj|par|m|mt)\.?$/i;
const UNIDADES_EMB = /^(cx|cxa|fd|fdo|frd|pct|pt|dz|sc|bd|cj)\.?$/i;

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
  const ehCodigo = t => /^\d[\d.\-/]*$/.test(t) || (t.length >= 6 && t.replace(/\D/g, '').length / t.length >= 0.8);
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
  for (let linha of texto.split(/\r?\n/)) {
    linha = linha.replace(/\s+/g, ' ').trim();
    if (linha.length < 6) continue;
    if ((linha.match(/[A-Za-zÀ-ÿ]/g) || []).length < 3) continue;
    if (IGNORAR.test(linha)) continue;

    const nums = tokensNumericos(linha);
    if (!nums.some(n => n.decimal)) continue;

    const trio = acharTrio(nums);
    let descricao, quantidade, valorUnitario, confiavel, inicioNumeros, unidade = '';
    if (trio) {
      quantidade = trio.q ? trio.q.valor : 1;
      valorUnitario = trio.u.valor;
      confiavel = true;
      inicioNumeros = trio.q ? trio.q.pos : trio.u.pos;
    } else {
      const dinheiro = nums.filter(n => n.decimal);
      const ult = dinheiro[dinheiro.length - 1];
      quantidade = 1;
      valorUnitario = ult.valor;
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
    if (um) unidade = um.replace('.', '').toUpperCase();

    const unPorEmb = UNIDADES_EMB.test(unidade) ? unidadesPorEmbalagem(descricao) : 1;
    const ean = nums.map(n => n.txt).find(t => /^\d{12,14}$/.test(t) && gtinOk(t)) || '';
    itens.push({ descricao, quantidade, unidade, valorUnitario, unPorEmb, confiavel, ean });
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
    const unidade = pega(det, 'uCom').toUpperCase();
    const quantidade = parseFloat(pega(det, 'qCom')) || 1;
    const vProd = parseFloat(pega(det, 'vProd')) || 0;
    const vDesc = parseFloat(pega(det, 'vDesc')) || 0;
    // custo real = (valor do produto − desconto do item) ÷ quantidade
    const valorUnitario = (vProd - vDesc) / quantidade || parseFloat(pega(det, 'vUnCom')) || 0;
    const unPorEmb = UNIDADES_EMB.test(unidade) ? unidadesPorEmbalagem(descricao) : 1;
    const ean = [pega(det, 'cEAN'), pega(det, 'cEANTrib')].find(c => /^\d{8,14}$/.test(c) && gtinOk(c)) || '';
    return { descricao, quantidade, unidade, valorUnitario, unPorEmb, confiavel: true, ean };
  });
}
