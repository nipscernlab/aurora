/**
 * menu_da_arvore.ts: o card de menu do botao direito da visao de pastas.
 *
 * So o card: montar os itens, posicionar sem passar da borda, fechar com
 * clique fora ou Escape, e um card por vez. Quais itens aparecem e o que cada
 * um faz e decisao do standard_tree_crud, de onde isto saiu (TODO 13.3).
 */

import { showCardNotification } from '../ui/notification.js';

export interface ItemDeMenu {
    icon: string;
    label: string;
    run: () => unknown;
    danger?: boolean;
    disabled?: boolean;
}

export type EntradaDeMenu = ItemDeMenu | 'divider';

export class MenuDaArvore {
    /** O card aberto agora, ou null. */
    aberto: HTMLElement | null = null;
    private dismiss: ((e: Event) => void) | null = null;
    private timerDeLigar: ReturnType<typeof setTimeout> | null = null;

    abrir(items: EntradaDeMenu[], x: number, y: number): void {
        const menu = document.createElement('div');
        menu.className = 'verilog-context-menu';
        menu.id = 'standard-tree-context-menu';

        for (const it of items) {
            if (it === 'divider') {
                const d = document.createElement('div');
                d.className = 'context-menu-divider';
                menu.appendChild(d);
                continue;
            }
            const el = document.createElement('div');
            el.className = 'context-menu-item'
                + (it.danger ? ' delete-item' : '')
                + (it.disabled ? ' disabled' : '');
            el.innerHTML = `<i class="ph ${it.icon}"></i><span></span>`;
            (el.querySelector('span') as HTMLElement).textContent = it.label;
            if (!it.disabled) {
                el.addEventListener('click', () => {
                    this.fechar();
                    Promise.resolve(it.run()).catch((err) => {
                        console.error('tree action failed:', err);
                        showCardNotification(String(err?.message || err), 'error', 4000);
                    });
                });
            }
            menu.appendChild(el);
        }

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        document.body.appendChild(menu);
        // A referencia fica no objeto, nao no id: o menu anterior continua no
        // DOM por 150 ms enquanto esvaece, e procurar por id nesse intervalo
        // devolvia o card velho e deixava o novo orfao. Botao direito repetido
        // empilhava um card por clique.
        this.aberto = menu;
        requestAnimationFrame(() => {
            if (this.aberto !== menu) return;
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
            if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
            menu.classList.add('show');
        });

        const dismiss = (e: Event) => {
            if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
            if (e.type === 'click' && menu.contains(e.target as Node)) return;
            this.fechar();
        };
        this.dismiss = dismiss;
        // Liga no proximo tick para o contextmenu que abriu o card nao o
        // fechar. Se outro menu abrir antes disso, o timer e cancelado em
        // fechar() e este dismiss nunca chega ao document.
        this.timerDeLigar = setTimeout(() => {
            this.timerDeLigar = null;
            if (this.dismiss !== dismiss) return;
            document.addEventListener('click', dismiss);
            document.addEventListener('contextmenu', dismiss);
            document.addEventListener('keydown', dismiss);
        }, 0);
    }

    fechar(): void {
        if (this.timerDeLigar) {
            clearTimeout(this.timerDeLigar);
            this.timerDeLigar = null;
        }
        const menu = this.aberto;
        if (menu) {
            this.aberto = null;
            // Some o id e os cliques: o card que esvaece nao pode ser
            // confundido com o que esta abrindo nem receber acoes.
            menu.removeAttribute('id');
            menu.style.pointerEvents = 'none';
            menu.classList.remove('show');
            setTimeout(() => menu.remove(), 150);
        }
        const dismiss = this.dismiss;
        if (dismiss) {
            this.dismiss = null;
            document.removeEventListener('click', dismiss);
            document.removeEventListener('contextmenu', dismiss);
            document.removeEventListener('keydown', dismiss);
        }
    }
}
