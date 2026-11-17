#!/usr/bin/env node
/*
 * Gera o index.html publicado a partir de fonte/app-fonte.html.
 *
 * O app é escrito em JSX dentro de <script type="text/babel">. Antes, o navegador de cada
 * pessoa baixava o Babel (~3 MB) e compilava ~700 KB de código toda vez que abria o app.
 * Este script faz essa compilação uma vez só, aqui, e ainda compacta o resultado.
 *
 * Uso: node fonte/construir.js   (precisa de @babel/standalone e terser instalados)
 * Edite SEMPRE o fonte/app-fonte.html e rode este script; não edite o index.html à mão.
 */
const fs = require("fs");
const path = require("path");

const raizModulos = process.env.MODULOS || path.join(__dirname, "node_modules");
const Babel = require(path.join(raizModulos, "@babel/standalone"));
const { minify } = require(path.join(raizModulos, "terser"));

const FONTE = path.join(__dirname, "app-fonte.html");
const SAIDA = process.env.SAIDA || path.join(__dirname, "..", "index.html");

const ABRE = '<script type="text/babel" data-presets="react">';
const TAG_BABEL = /<script src="[^"]*babel-standalone[^"]*"><\/script>\n?/;

(async () => {
  const html = fs.readFileSync(FONTE, "utf8");
  const ini = html.indexOf(ABRE);
  if (ini < 0) throw new Error("Não achei o <script type=\"text/babel\"> no fonte.");
  const fim = html.indexOf("</script>", ini);
  const jsx = html.slice(ini + ABRE.length, fim);

  const { code: js } = Babel.transform(jsx, { presets: ["react"], sourceType: "script", compact: false, comments: false });
  const min = process.env.SEM_COMPACTAR ? { code: js } : await minify(js, {
    ecma: 2020,
    module: false,
    toplevel: false,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  });
  if (!min.code) throw new Error("A compactação não devolveu código.");
  if (/<\/script/i.test(min.code)) throw new Error("O código gerado contém </script>; não dá para embutir.");

  if (!TAG_BABEL.test(html)) throw new Error("Não achei a tag do babel-standalone no fonte.");
  const saida = html.slice(0, ini).replace(TAG_BABEL, "")
    + "<script>/* Gerado por fonte/construir.js a partir de fonte/app-fonte.html. Não edite aqui. */\n"
    + min.code + "\n" + html.slice(fim);

  // Marca de versão: o app compara com a do servidor para se atualizar sozinho.
  const versao = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  fs.writeFileSync(SAIDA, saida.replace("__VERSAO_BUILD__", versao));
  // Arquivo pequeno com a versão: o app confere este (poucos bytes) em vez de baixar o index.html inteiro.
  fs.writeFileSync(path.join(path.dirname(SAIDA), "versao.json"), JSON.stringify({ versao }) + "\n");
  console.log(`ok: fonte ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB -> index.html ${(Buffer.byteLength(saida) / 1024).toFixed(0)} KB (script ${(Buffer.byteLength(jsx) / 1024).toFixed(0)} KB -> ${(Buffer.byteLength(min.code) / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
