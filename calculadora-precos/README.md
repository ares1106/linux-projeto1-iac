# Calculadora de Preços do Mercado

Site/app (funciona no celular e pode ser "instalado" na tela inicial) para calcular o preço de venda
colocando a % de lucro em cima do custo.

## O que faz

- **Calcular**: custo + % de lucro → preço de venda. Lucro inicial de **30%**, com botões −5/−1/+1/+5.
- **Ramos de produto** (Ajustes): cada ramo tem a sua % (ex.: Bebidas 25%, Hortifruti 45%). Ao escolher o ramo a % é preenchida.
- **Ajustar preço manualmente**: mostra na hora o preço calculado, o manual, a diferença em R$ e % e o lucro real.
  Ao salvar, o ajuste fica registrado no **Histórico**.
- **Histórico**: lista todos os ajustes manuais e um resumo por ramo com o lucro real médio praticado,
  com botão para adotar essa % no ramo. Exporta CSV (abre no Excel).
- **Aumento de custo**: quando um produto já salvo é comprado de novo (digitado ou pela nota), o app avisa se o custo
  subiu ou baixou, quanto em R$ e em %, o custo e a data da compra anterior e como fica o novo preço de venda.
  Cada produto guarda o histórico de custos (aba Produtos), e a aba Histórico lista todas as variações
  (filtro "só aumentos", exporta CSV). Na tabela da nota aparece a coluna "Última compra" e um resumo dos aumentos.
- **Nota fiscal**: tire foto da nota (ou escolha imagem, PDF ou o XML da NF-e) e os itens aparecem numa tabela
  para conferir e salvar todos de uma vez. A coluna "Un/emb" divide o custo de caixas/fardos por unidade.
  - *XML da NF-e*: valores exatos (recomendado quando o fornecedor envia o XML por e-mail).
  - *Leitura no aparelho*: OCR grátis (Tesseract), sem internet depois da primeira carga. Precisa de foto reta e nítida.
  - *Leitura inteligente (Claude)*: bem mais precisa em fotos tortas e cupons; aceita PDF. Precisa de uma chave de API
    de console.anthropic.com (fica salva só no aparelho; cada nota custa alguns centavos).
- **Backup**: os dados ficam no navegador do aparelho. Use "Baixar backup"/"Restaurar backup" para guardar ou trocar de aparelho.

## Fórmula

```
preço = custo × (1 + lucro% / 100)
lucro real (ajuste manual) = (preço manual ÷ custo − 1) × 100
diferença = preço manual − preço calculado
```

## Como usar

É um site estático (HTML/CSS/JS, sem servidor). Opções:

1. **GitHub Pages**: no repositório, *Settings → Pages → Deploy from a branch*, escolha o branch e a pasta `/ (root)`.
   O app fica em `https://<usuario>.github.io/<repositorio>/calculadora-precos/`.
   No celular, abra o link e use "Adicionar à tela inicial".
2. **No computador**: dentro desta pasta rode `python3 -m http.server` e abra `http://localhost:8000`.

## Arquivos

- `index.html`, `style.css` — telas
- `app.js` — cálculo, produtos, histórico, ramos, backup
- `nota.js` — leitura da nota (foto/PDF/XML) e tabela de conferência
- `parser.js` — interpretação do texto lido e do XML da NF-e
- `manifest.json`, `sw.js`, `icon.svg` — instalação como app
