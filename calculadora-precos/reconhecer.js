/* Reconhecimento de produto por nome + peso/volume + marca (+ código de barras) */
(function (global) {
  'use strict';

  // Abreviações comuns em notas fiscais → palavra completa
  const ABREV = {
    REFRIG: 'REFRIGERANTE', REFRI: 'REFRIGERANTE', RFR: 'REFRIGERANTE',
    T1: 'TIPO 1', TP1: 'TIPO 1', T2: 'TIPO 2', TP2: 'TIPO 2', TP: 'TIPO', LT: 'LATA',
    COND: 'CONDENSADO', LTE: 'LEITE', LEIT: 'LEITE',
    CAF: 'CAFE', ACUC: 'ACUCAR', ACU: 'ACUCAR', FEIJ: 'FEIJAO', FJ: 'FEIJAO',
    MARG: 'MARGARINA', CERV: 'CERVEJA', CERVJ: 'CERVEJA', AG: 'AGUA', MIN: 'MINERAL',
    BISC: 'BISCOITO', BISCT: 'BISCOITO', BOL: 'BOLACHA', DET: 'DETERGENTE', DETERG: 'DETERGENTE',
    SAB: 'SABAO', SABON: 'SABONETE', SABNT: 'SABONETE', AMAC: 'AMACIANTE', DESINF: 'DESINFETANTE',
    PAP: 'PAPEL', HIG: 'HIGIENICO', CR: 'CREME', DENT: 'DENTAL', MAC: 'MACARRAO', MACAR: 'MACARRAO',
    ESPAG: 'ESPAGUETE', OL: 'OLEO', AZ: 'AZEITE', EXT: 'EXTRA', VIRG: 'VIRGEM',
    INT: 'INTEGRAL', DESN: 'DESNATADO', SEMIDESN: 'SEMIDESNATADO', TRAD: 'TRADICIONAL',
    CHOC: 'CHOCOLATE', ACHOC: 'ACHOCOLATADO', IOG: 'IOGURTE', REQ: 'REQUEIJAO', MUSS: 'MUSSARELA',
    PRES: 'PRESUNTO', SALS: 'SALSICHA', LING: 'LINGUICA', FRG: 'FRANGO', FGO: 'FRANGO',
    CONG: 'CONGELADO', RESF: 'RESFRIADO', TEMP: 'TEMPERO', MOL: 'MOLHO', TOM: 'TOMATE',
    EXTR: 'EXTRATO', MAION: 'MAIONESE', FAR: 'FARINHA', TRIG: 'TRIGO', MAND: 'MANDIOCA',
    POL: 'POLVILHO', GEL: 'GELATINA', SUC: 'SUCO', NECT: 'NECTAR', ENERG: 'ENERGETICO',
    PET: 'PET', LATA: 'LATA', LN: 'LONG NECK', ZERO: 'ZERO', DIET: 'DIET', LIGHT: 'LIGHT',
    ORIG: 'ORIGINAL', TRADIC: 'TRADICIONAL', GRANUL: 'GRANULADO', REFIN: 'REFINADO',
    CRIST: 'CRISTAL', ROSQ: 'ROSQUINHA', REC: 'RECHEADO', RECH: 'RECHEADO', MORT: 'MORTADELA'
  };
  // Palavras que não ajudam a identificar o produto
  const IGNORAR = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'C', 'COM', 'SEM', 'EM', 'P', 'PARA',
    'UN', 'UND', 'UNID', 'UNIDADE', 'PCT', 'PC', 'PCTE', 'PACOTE', 'CX', 'CXA', 'CAIXA', 'FD', 'FDO', 'FARDO',
    'EMB', 'EMBALAGEM', 'X', 'GF', 'GARRAFA', 'SC', 'SACO', 'BD', 'BDJ', 'BANDEJA', 'POTE', 'FR', 'FRASCO', 'TB', 'TUBO']);

  const semAcento = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  /** Extrai peso/volume e converte para gramas ou mililitros: "5KG" → "5000G", "2L" → "2000ML" */
  function extrairMedida(s) {
    const re = /(\d+(?:[.,]\d+)?)\s*(KG|KGS|K|GRS|GR|G|LTS|LT|L|ML)\b/g;
    let m, medida = null;
    while ((m = re.exec(s))) {
      const v = parseFloat(m[1].replace(',', '.'));
      const u = m[2];
      if (!isFinite(v) || v <= 0) continue;
      if (/^K/.test(u)) medida = Math.round(v * 1000) + 'G';
      else if (/^G/.test(u)) medida = Math.round(v) + 'G';
      else if (u === 'ML') medida = Math.round(v) + 'ML';
      else medida = Math.round(v * 1000) + 'ML';
    }
    return medida;
  }

  /** Transforma um nome em "assinatura": palavras importantes, medida e quantidade por embalagem */
  const cache = new Map();
  function chave(nome) {
    const k0 = String(nome || '');
    if (cache.has(k0)) return cache.get(k0);
    if (cache.size > 5000) cache.clear();
    const r = chaveSemCache(k0);
    cache.set(k0, r);
    return r;
  }
  function chaveSemCache(nome) {
    let s = semAcento(nome).replace(/[^\w\s.,/]/g, ' ');
    const medida = extrairMedida(s);
    let pack = null;
    const mp = s.match(/\b(\d{1,3})\s*X\s*\d/) || s.match(/\b(?:C\/|CX|FD|PCT)\s*(\d{1,3})\b/);
    if (mp) pack = Number(mp[1]);
    // remove medidas e packs do texto antes de separar as palavras
    s = s.replace(/\d+(?:[.,]\d+)?\s*(KG|KGS|K|GRS|GR|G|LTS|LT|L|ML)\b/g, ' ')
         .replace(/\b\d{1,3}\s*X\b/g, ' ').replace(/\bC\/\s*\d+/g, ' ');
    const tokens = [];
    s.split(/[\s.,/]+/).forEach(t => {
      if (!t) return;
      if (/^\d{6,}$/.test(t)) return; // códigos
      // erros típicos de leitura de foto: 0 no lugar de O, 1 no lugar de I
      if (/[A-Z]/.test(t) && /\d/.test(t) && !ABREV[t] && t.replace(/\d/g, '').length >= 2) t = t.replace(/0/g, 'O').replace(/1/g, 'I');
      const exp = ABREV[t];
      (exp ? exp.split(' ') : [t]).forEach(x => {
        if (IGNORAR.has(x)) return;
        if (x.length === 1 && !/\d/.test(x)) return;
        tokens.push(x);
      });
    });
    return { tokens, medida, pack };
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const v = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let ant = v[0]; v[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = v[j];
        v[j] = Math.min(v[j] + 1, v[j - 1] + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1));
        ant = tmp;
      }
    }
    return v[b.length];
  }

  function simPalavra(x, y) {
    if (x === y) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx || ny) return 0; // números diferentes = produtos diferentes
    if (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))) return 0.85; // abreviação
    if (Math.min(x.length, y.length) < 4) return 0;
    const r = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
    return r >= 0.78 ? r : 0; // tolera erro de leitura (OCR)
  }

  /** 0 a 1: o quanto dois nomes parecem ser o mesmo produto */
  function similaridade(a, b) {
    if (typeof a === 'string') a = chave(a);
    if (typeof b === 'string') b = chave(b);
    if (!a.tokens.length || !b.tokens.length) return 0;
    const melhor = (t, lista) => lista.reduce((m, u) => Math.max(m, simPalavra(t, u)), 0);
    const ma = a.tokens.map(t => melhor(t, b.tokens)), mb = b.tokens.map(t => melhor(t, a.tokens));
    let dice = (ma.reduce((x, y) => x + y, 0) + mb.reduce((x, y) => x + y, 0)) / (a.tokens.length + b.tokens.length);
    if (a.tokens.join('') === b.tokens.join('')) dice = 1; // "KI CALDO" = "KICALDO"
    // Palavra sobrando dos DOIS lados = troca de marca/sabor (Tio João x Camil): outro produto
    else if (ma.some(v => v === 0) && mb.some(v => v === 0)) dice *= 0.6;
    // Tamanho diferente (1kg x 5kg, 350ml x 2L) ou embalagem diferente = outro produto
    if ((a.medida && b.medida && a.medida !== b.medida) || (a.pack && b.pack && a.pack !== b.pack)) return Math.min(dice, 1) * 0.3;
    const bonus = a.medida && b.medida ? 0.15 : (a.medida || b.medida ? 0.05 : 0.1);
    return Math.min(1, dice * 0.85 + bonus);
  }

  /** Valida código de barras EAN-8/12/13/14 pelo dígito verificador */
  function gtinValido(cod) {
    cod = String(cod || '').replace(/\D/g, '');
    if (![8, 12, 13, 14].includes(cod.length) || /^0+$/.test(cod)) return false;
    const d = cod.split('').map(Number); const dv = d.pop();
    const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (soma % 10)) % 10 === dv;
  }

  // Acentos de palavras comuns (as notas costumam vir sem acento)
  const ACENTOS = {
    JOAO: 'João', FEIJAO: 'Feijão', ACUCAR: 'Açúcar', CAFE: 'Café', OLEO: 'Óleo', SABAO: 'Sabão',
    MACARRAO: 'Macarrão', PAO: 'Pão', LIMAO: 'Limão', MAMAO: 'Mamão', REQUEIJAO: 'Requeijão', PILAO: 'Pilão',
    HIGIENICO: 'Higiênico', AGUA: 'Água', CHA: 'Chá', LINGUICA: 'Linguiça', FECULA: 'Fécula', ALCOOL: 'Álcool',
    PESSEGO: 'Pêssego', MACA: 'Maçã', ACAI: 'Açaí', MELAO: 'Melão', CAMARAO: 'Camarão', SALMAO: 'Salmão',
    PURE: 'Purê', PE: 'Pé', LAMPADA: 'Lâmpada', ESPONJA: 'Esponja', SABAOEMPO: 'Sabão em pó', PO: 'Pó',
    GRAOS: 'Grãos', GRAO: 'Grão', FILE: 'Filé', CONTRAFILE: 'Contrafilé', COXAO: 'Coxão', LAGARTO: 'Lagarto',
    MUCARELA: 'Muçarela', MUSSARELA: 'Muçarela', PRATO: 'Prato', TEMPERO: 'Tempero', ENERGETICO: 'Energético',
    NECTAR: 'Néctar', GELEIA: 'Geleia', ACHOCOLATADO: 'Achocolatado', SAO: 'São', SALGADINHO: 'Salgadinho',
    AMENDOIM: 'Amendoim', PAPEL: 'Papel', TOALHA: 'Toalha', MAIONESE: 'Maionese', VINAGRE: 'Vinagre',
    ORGANICO: 'Orgânico', ACUCARADO: 'Açucarado', FRANCES: 'Francês', LEITE: 'Leite', CONDENSADO: 'Condensado',
    TRADICIONAL: 'Tradicional', LIQUIDO: 'Líquido', CONCENTRADO: 'Concentrado', GRATIS: 'Grátis', LIMPEZA: 'Limpeza', UNIAO: 'União', YPE: 'Ypê', MOCA: 'Moça', PAES: 'Pães', LIMOES: 'Limões', FEIJOES: 'Feijões', COCO: 'Coco'
  };
  const MINUSC = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'COM', 'SEM', 'EM', 'PARA']);

  /** "ARROZ TIO JOAO T1 5KG" → "Arroz Tio João Tipo 1 5kg". Nomes já digitados normalmente não mudam. */
  function nomeAmigavel(nome) {
    nome = String(nome || '').trim().replace(/\s+/g, ' ');
    const letras = nome.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (!letras || letras !== letras.toUpperCase()) return nome; // já tem minúsculas: foi escrito à mão
    const sa = semAcento(nome);
    const out = [];
    sa.split(' ').forEach((t, i) => {
      // medidas: 5KG → 5kg, 2000ML → 2L, 500GR → 500g
      const m = t.match(/^(\d+(?:[.,]\d+)?)(KG|KGS|K|GRS|GR|G|LTS|LT|L|ML)$/);
      if (m) {
        let v = m[1], u = m[2];
        if (u === 'ML' && parseFloat(v) >= 1000) { v = String(parseFloat(v) / 1000).replace('.', ','); u = 'L'; }
        u = /^K/.test(u) ? 'kg' : /^G/.test(u) ? 'g' : u === 'ML' ? 'ml' : 'L';
        out.push(v + u); return;
      }
      if (/^\d+X\d/.test(t)) { out.push(t.replace('X', 'x').toLowerCase().replace(/(\d)l$/, '$1L')); return; }
      const exp = ABREV[t] && !['PET', 'LATA', 'ZERO', 'DIET', 'LIGHT'].includes(t) ? ABREV[t] : t;
      exp.split(' ').forEach(w => {
        if (ACENTOS[w]) out.push(ACENTOS[w]);
        else if (i > 0 && MINUSC.has(w)) out.push(w.toLowerCase());
        else if (/^(KG|G|GR|ML|L|LT|UN)$/.test(w)) out.push(w === 'L' || w === 'LT' ? 'L' : w.toLowerCase());
        else if (/\d/.test(w) || w.length <= 2 && !/^[AEIOU]$/.test(w)) out.push(w); // códigos/siglas
        else out.push(w.toLowerCase().replace(/(^|-)([a-z])/g, (x, h, c) => h + c.toUpperCase()));
      });
    });
    return out.join(' ').replace(/\bC\//g, 'c/');
  }

  global.Reconhecer = { chave, similaridade, gtinValido, extrairMedida, nomeAmigavel };
})(typeof window !== 'undefined' ? window : globalThis);
