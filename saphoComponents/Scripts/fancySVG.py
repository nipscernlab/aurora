import sys
import re
import os
from bs4 import BeautifulSoup

def arrancadeiro_de_texto(text):
    parts = text.split("\\")
    if len(parts) >= 2:
        return parts[1]
    return text

def nightmode(soup):
    svg_str = str(soup)
    inverted_str = svg_str.replace("#000", "#fff")
    soup = BeautifulSoup(inverted_str, "lxml-xml")

    shapes = soup.select('rect[class^="cell_"], path[class^="cell_"]') #blocos
    for shape in shapes:
        shape['fill'] = '#0092b8'

    for shape in soup.select('.splitjoinBody'):
        shape['fill'] = '#0092b8'

    return soup

def lightmode(soup):
    shapes = soup.select('rect[class^="cell_"], path[class^="cell_"]') #blocos
    for shape in shapes:
        shape['fill'] = '#0092b8'

    for shape in soup.select('.splitjoinBody'):
        shape['fill'] = '#0092b8'

    return soup

def add_hyperlinks(soup, prism_path, processor_name):
    # Mapping of component names to SVG filenames
    component_map = {
        'addr_dec': 'addr_dec.svg',
        'core': 'core.svg',
        'instr_dec': 'instr_dec.svg',
        'mem_data': 'mem_data.svg',
        'mem_instr': 'mem_instr.svg',
        'myFIFO': 'myFIFO.svg',
        'pc': 'pc.svg',
        'prefetch': 'prefetch.svg',
        'processor': f'p_{processor_name}.svg',
        'rel_addr': 'rel_addr.svg',
        'stack': 'stack.svg',
        'stack_pointer': 'stack_pointer.svg',
        'ula': 'ula.svg'
    }

    # Find all text elements
    text_nodes = soup.find_all('text')
    
    for node in text_nodes:
        text = node.string
        
        # Check if any of the component names is in the text
        for component, filename in component_map.items():
            if component in text:
                # Add hyperlink
                link = soup.new_tag('a')
                link['xlink:href'] = os.path.join(prism_path, filename)
                link['target'] = '_blank'
                
                # Wrap the original text node with the link
                node.wrap(link)
                break

    return soup

def main():
    if len(sys.argv) != 6:  # Updated to include processor name and PRISM path
        print("Uso: fancySVG.exe <0/1> \"<name>\" \"<path de entrada>\" \"<path de saida>\" \"<prism_path>\"")
        sys.exit(1)

    nightmode_flag = sys.argv[1]
    processor_name = sys.argv[2]
    input_file = sys.argv[3]
    output_file = sys.argv[4]
    prism_path = sys.argv[5]

    if nightmode_flag not in ["0", "1"]:
        print("Erro: Flag deve ser 0 (lightmode) ou 1 (nightmode).")
        sys.exit(1)

    if not os.path.isfile(input_file):
        print(f"Erro: Arquivo de entrada '{input_file}' inexistente ou de formato desconhecido.")
        sys.exit(1)

    with open(input_file, "r", encoding="utf-8") as f:
        svg_content = f.read()
    soup = BeautifulSoup(svg_content, "lxml-xml")

    # Process $paramod texts
    text_nodes = soup.find_all(string=re.compile(r'\$paramod'))
    for node in text_nodes:
        new_text = arrancadeiro_de_texto(node)
        node.replace_with(new_text)

    # Apply night/light mode
    if nightmode_flag == "1":
        soup = nightmode(soup)
    else:
        soup = lightmode(soup)

    # Add hyperlinks
    soup = add_hyperlinks(soup, prism_path, processor_name)

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(str(soup))

    print(f"Salvo em '{output_file}'.")

if __name__ == "__main__":
    main()

# COMPILAR (no modo pasta) COM: 
# 
# pyinstaller --onefile --hidden-import=lxml --hidden-import=lxml.etree fancySVG.py