#!/usr/bin/env python3
import argparse
import subprocess
import tempfile
import os
import re
import sys
import json

from bs4 import BeautifulSoup

# -------------------------------------------------------------------------
# Template HTML
# Encapsula o svg e lida com os clicks nos elementos
# -------------------------------------------------------------------------

HTML_TMPL = """<!DOCTYPE html>
<html lang="pt">  
<head>
  <meta charset="UTF-8">  
  <meta name="viewport" content="width=device-width, initial-scale=2.0">  
  <title>Brengs: {module}</title>  
  <style>
    body {{ margin:0; padding:0; display:flex; justify-content:center; align-items:center; height:100vh; background:{bg_color}; color:{text_color}; }}
    
    /* Parte para mudar a caixota entorno do design */
    #netlist-container {{ position:relative;
                          border:1px solid {border_color};
                          background:{card_color};
                          padding:0;
                          max-width:90vw;
                          max-height:90vh;
                          overflow: auto;
                          box-shadow:0 2px 8px rgba(0,0,0,0.1); }}

    #netlist-container svg {{ display: block;   /* removes default inline-block whitespace */
                              width: 100%;
                              height: 100%;}}
                   
    /* svg {{ display:block; max-width:100%; max-height:100%; }} */

    /* Marcando os hightlighsts  */
    .highlighted {{ stroke:{highlight_color} !important; stroke-width:4 !important; fill-opacity:0.8; }}

    /* <rect> e <path> mudam o cursor (todos começam com o cell_ ou net_) */
    rect[class^="cell_"], path[class^="cell_"],
    *[class^="net_"] {{
      cursor: pointer;
    }}

    /* Sombra tipo o dropshadow do Photoshop */
    rect[class^="cell_"], path[class^="cell_"], .splitjoinBody {{
      filter: drop-shadow(2px 2px 2px rgba(0,0,0,1));
    }}

    #back-btn {{ position:absolute; top:10px; left:10px; padding:6px 10px; background:{accent_color}; color:#fff; border:none; border-radius:4px; cursor:pointer; }} /* Botões de voltar */
    #back-btn:hover {{ background:{accent_dark}; }}
  </style>
</head>
<body>
  <button id="back-btn" onclick="goBack()" style="display:none;">◀ Back</button>
  <div id="netlist-container">  
    {svg}
  </div>
  <script> /* Parte relevante a JS */
    const params = new URLSearchParams(window.location.search);
    if (params.get('module')) document.getElementById('back-btn').style.display = 'block';

    // Seleciona fios e blocos
    document.querySelectorAll('[class^="cell_"], [class^="net_"]').forEach(el => {{
      el.addEventListener('click', e => {{
        e.stopPropagation(); // sei la, ficava dando pau sem 
        // arranca highlight anterior
        document.querySelectorAll('.highlighted').forEach(h => h.classList.remove('highlighted'));

        const cls = el.classList[0] || '';
        if (cls.startsWith('cell_')) {{
            // highlight de bloco (singular)
            el.classList.add('highlighted');
            const module = cls.replace(/^cell_/, '');

            // Electron dava pau sem isso
            if (window.electronAPI && window.electronAPI.exploreBlock) {{
                window.electronAPI
                .exploreBlock(module)
                .catch(err => console.error('exploreBlock failed:', err));
            }} else {{
                // fallback to your old behavior in a regular browser
                window.location.search = '?' + new URLSearchParams({module});
            }}
        }} else if (cls.startsWith('net_')) {{
          // Highlight de vários sementos
          Array.from(document.getElementsByClassName(cls))
               .forEach(seg => seg.classList.add('highlighted'));
        }}
      }});
    }});

    function goBack() {{ window.history.back(); }} //volta pro nível anterior
  </script>
</body>
</html>"""

# -------------------------------------------------------------------------
# Limpeza dos nomes (script original de deixar tudo mais bonito)
# -------------------------------------------------------------------------
def arranca_texto(soup):
    for node in soup.find_all(string=re.compile(r'\$paramod')):
        parts = node.split('\\')
        if len(parts) >= 2:
            node.replace_with(parts[1])

    for txt in soup.find_all('text'):
        if txt.string and ('\\' in txt.string or '/' in txt.string):
            txt.string.replace_with(re.split(r"\\\\|/", txt.string.strip())[-1])

    return soup

# -------------------------------------------------------------------------
# Definição do tema (script original de deixar tudo mais bonito)
# -------------------------------------------------------------------------
def aplica_tema(soup, theme):
    if theme == 'dark':

        # Inverte as cores
        svg_str = str(soup)
        soup = BeautifulSoup(svg_str.replace('#000', '#fff'), 'xml')

        # Backrooudn não clicável
        bg = soup.new_tag('rect', width='100%', height='100%', fill='#232323')
        bg['pointer-events'] = 'none'
        soup.find('svg').insert(0, bg)

        # cor dos blocos
        selector = 'rect[class^="cell_"], path[class^="cell_"], .splitjoinBody'
        for shape in soup.select(selector):
            shape['fill'] = '#0092b8'

    else:
        bg = soup.new_tag('rect', width='100%', height='100%', fill='#f5f5f5')
        bg['pointer-events'] = 'none'
        soup.find('svg').insert(0, bg)
        selector = 'rect[class^="cell_"], path[class^="cell_"], .splitjoinBody'

        for shape in soup.select(selector):
            shape['fill'] = '#0092b8'

    return soup

# -------------------------------------------------------------------------
# Comandos no CMD (e erros)
# -------------------------------------------------------------------------
def run_cmd(cmd, cwd=None):
    proc = subprocess.run(cmd, shell=True, cwd=cwd,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True)
    
    if proc.returncode:
        raise RuntimeError(f"Falha no comando: {cmd}\n{proc.stderr}")
    
    return proc.stdout

# -------------------------------------------------------------------------
# Encontra arquivos verilog no diretorio escolhido
# -------------------------------------------------------------------------
def procura_arquivos_verilog():
    files = [f for f in os.listdir('.') if f.lower().endswith('.v')]
    
    if not files:
        sys.exit('Erro: sem arquivos .v no diretório atual')
    
    return files

# -------------------------------------------------------------------------
# Encontra o arquivo no topo da hierarquia por eliminação
# -------------------------------------------------------------------------
def procura_top_module(files, specified):
    if specified:
        return specified
    
    helpers = {'addr_dec.v','core.v','instr_dec.v','myfifo.v','processor.v','ula.v'}
    candidates = [f for f in files if f.lower() not in helpers]

    if len(candidates) != 1:
        sys.exit(f'Topo da hierarquia não encontrado (achados: {candidates})')

    return os.path.splitext(candidates[0])[0]

# -------------------------------------------------------------------------
# Carrega ou cria o mapeamento da hierarquia do projeto
# -------------------------------------------------------------------------
def load_mapping(outdir):
    idx = os.path.join(outdir, 'modules_index.json')

    if os.path.isfile(idx):
        try:
            return json.load(open(idx)), idx
        except:
            pass

    return {}, idx

# -------------------------------------------------------------------------
# Gera ou avisa sobre a existência de html de um módulo
# -------------------------------------------------------------------------
def genera_modulo_html(module, files, theme, colors, outdir, mapping, idx_file):
    html_path = os.path.join(outdir, f'{module}.html')

    # Já existe
    if module in mapping and os.path.isfile(mapping[module]):
        print(f"Usando cache para módulo '{module}'")
        return mapping

    # Gera
    files_arg = ' '.join(f'"{f}"' for f in files)
    with tempfile.TemporaryDirectory() as td:
        jsonf = os.path.join(td, 'design.json')
        raw_svg = os.path.join(td, 'raw.svg')
        run_cmd(f'yosys -p "read_verilog {files_arg}; hierarchy -top {module}; proc; write_json {jsonf}"')
        run_cmd(f'netlistsvg {jsonf} -o {raw_svg}')
        soup = BeautifulSoup(open(raw_svg, encoding='utf8'), 'xml')
        soup = arranca_texto(soup)
        soup = aplica_tema(soup, theme)
        svg_str = str(soup.find('svg'))

    # Renderiza html
    html = HTML_TMPL.format(module=module, svg=svg_str, **colors)
    with open(html_path, 'w', encoding='utf8') as f:
        f.write(html)
    mapping[module] = html_path
    json.dump(mapping, open(idx_file, 'w'), indent=2)
    print(f"Gerado HTML para '{module}' -> {html_path}")
    return mapping

# -------------------------------------------------------------------------
# Main
# -------------------------------------------------------------------------
def main():

    # Parsing dos argumentos de entrada no terminal 
    parser = argparse.ArgumentParser(description='Gera os arquivos HTML dos diagramas de circuito para o SAPHO')
    parser.add_argument('-o', '--output-dir', help='Diretorio criado para os arquivos gerados', default='html_out')
    parser.add_argument('-m', '--module', help='Nome do modulo (default: top da hierarquia)')
    parser.add_argument('--theme', choices=['light', 'dark'], required=True,
                        help='Escolha do tema (light ou dark)')
    parser.add_argument('--list-modules', action='store_true',
                        help='Exibe mapeamento JSON')
    args = parser.parse_args()

    # Temas e cores pro HTML
    if args.theme == 'dark':
        colors = dict(bg_color='#141414', card_color='#343434', text_color='#eee',
                      border_color='#343434', highlight_color='#e74c3c',
                      accent_color='#3498db', accent_dark='#2980b9')
    else:
        colors = dict(bg_color='#f5f5f5', card_color='#fff', text_color='#111',
                      border_color='#ccc', highlight_color='#e74c3c',
                      accent_color='#3498db', accent_dark='#2980b9')

    # Cria diretorio de saida
    outdir = args.output_dir
    os.makedirs(outdir, exist_ok=True)

    # Procurador de arquivo verilog
    arquivos_verilog = procura_arquivos_verilog()

    # Encontra o topo da hierarquia por eliminação
    top = procura_top_module(arquivos_verilog, args.module)
    
    # Interpreta OU cria o mapeamento da hirarquia
    mapping, idx_file = load_mapping(args.output_dir)
    mapping = genera_modulo_html(top, arquivos_verilog, args.theme, colors,
                                   args.output_dir, mapping, idx_file)

    if args.list_modules:
        print(json.dumps(mapping, indent=2))

#Para talvez futura integração e/ou chamada das funções feitas aqui
if __name__ == '__main__': 
    main()

# -------------------------------------------------------------------------
# Resumo do uso no formato de script:
# O comando deve ser executado já na pasta com os arquivos .v:   
#
#   python {Diretório do script (incluindo o "fancySVG.py")} --theme (light/dark) --output-dir (ou simplesmente "-o") {Pasta para output}
#
# Exemplo:
#
#   python D:\UFJFProgramas\SVG\fancySVG.py --theme dark --output-dir RTL_dark
#
# ou
#
#   python D:\UFJFProgramas\SVG\fancySVG.py --theme dark -o RTL_dark
#
#
#
# OUTROS USOS:
# Dá pra gerar um módulo específico:
#   python {Diretório do script (incluindo o "fancySVG.py")} --theme (light/dark) --output-dir (ou simplesmente "-o") {Pasta para output} --module {módulo de interesse} 
#
# Exemplo:
#   python D:\UFJFProgramas\SVG\fancySVG.py --theme light --output-dir listagem2 --module core 
#
#
#
# Ele também mostra os módulos cujo html foi gerado com:
#   python {Diretório do script (incluindo o "fancySVG.py")} --theme (light/dark) --output-dir (ou simplesmente "-o") --list-modules
#
#  Exemplo:
#   python D:\UFJFProgramas\SVG\fancySVG.py --theme light --output-dir listagem --list-modules   
# -------------------------------------------------------------------------