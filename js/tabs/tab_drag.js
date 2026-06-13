/**
 * Tab drag-and-drop reordering for the editor tab bar.
 *
 * Wires the HTML5 drag API onto every `.tab` element inside #tabs-container,
 * shows a vertical drop indicator at the prospective insertion point, and
 * persists the new order to localStorage so it survives reloads.
 *
 * Mixin shape: same pattern as tab_viewers — methods reference `this` and
 * are installed on TabManager via Object.assign at the bottom of
 * tab_manager.js.
 */

export const tabDrag = {
    initSortableTabs() {
        const tabsContainer = document.getElementById('tabs-container');
        if (!tabsContainer) return;

        // Suppress the browser's default "open as URL" behaviour for any drag
        // that escapes the tab bar.
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => e.preventDefault());

        let draggedTab = null;
        let draggedTabPath = null;
        let dragStartX = 0;
        let hasMovedEnough = false;
        let rafPending = false;

        // FLIP: remember each tab's position, mutate the DOM, then play every
        // displaced tab from its old spot to the new one with a short transform
        // transition — so neighbours GLIDE to make room instead of snapping.
        const flip = (mutate) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
            const before = tabs.map((t) => t.getBoundingClientRect().left);
            mutate();
            tabs.forEach((t, i) => {
                if (t === draggedTab) return;            // the dragged tab isn't slid
                const dx = before[i] - t.getBoundingClientRect().left;
                if (!dx) return;
                t.style.transition = 'none';
                t.style.transform = `translateX(${dx}px)`;
                void t.offsetWidth;                      // commit the start frame
                t.style.transition = 'transform 190ms var(--ease-aurora)';
                t.style.transform = '';
            });
        };

        const clearTabTransforms = () => {
            tabsContainer.querySelectorAll('.tab').forEach((t) => {
                t.style.transition = '';
                t.style.transform = '';
            });
        };

        // The tab the cursor would insert BEFORE (null → append at the end).
        const getReferenceTab = (x) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab:not(.dragging)'));
            for (const tab of tabs) {
                const rect = tab.getBoundingClientRect();
                if (x < rect.left + rect.width / 2) return tab;
            }
            return null;
        };

        // Live reorder while dragging, animated via FLIP.
        const liveReorder = (x) => {
            if (!draggedTab) return;
            const ref = getReferenceTab(x);
            if (ref === draggedTab) return;
            const already = ref
                ? draggedTab.nextElementSibling === ref
                : draggedTab === tabsContainer.querySelector('.tab:last-of-type');
            if (already) return;
            flip(() => {
                if (ref) tabsContainer.insertBefore(draggedTab, ref);
                else tabsContainer.appendChild(draggedTab);
            });
        };

        const handleDragStart = (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;

            draggedTab = tab;
            draggedTabPath = tab.getAttribute('data-path');
            dragStartX = e.clientX;
            hasMovedEnough = false;

            e.dataTransfer.effectAllowed = 'move';
            // Custom MIME so Monaco doesn't treat the drop as text and
            // paste the file path into the buffer when the user drops a
            // tab onto the editor area. Drop targets (split panes + main
            // shell) read this same key — see split_editor.js.
            e.dataTransfer.setData('application/x-aurora-tab-path', draggedTabPath);

            // Flag the drag as an Aurora tab drag originating in the main pane
            // (index 0), so split-pane drop targets accept it and know its
            // source for move semantics. Cleared in handleDragEnd.
            if (window.SplitEditorManager) {
                window.SplitEditorManager._dragActive = true;
                window.SplitEditorManager._dragSourcePane = 0;
            }

            // Suppress the native ghost image — our own .dragging style on the
            // source plus the live FLIP reorder carry the visual feedback.
            const dragImage = document.createElement('div');
            dragImage.style.opacity = '0';
            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, 0, 0);
            setTimeout(() => dragImage.remove(), 0);

            // Defer the dragging class so Chrome's drag image capture happens
            // before we change the source's appearance.
            setTimeout(() => {
                if (draggedTab) {
                    tab.classList.add('dragging');
                    tabsContainer.classList.add('dragging-active');
                }
            }, 10);
        };

        const handleDrag = (e) => {
            if (!draggedTab) return;
            // The HTML5 drag event reports clientX 0 on the final event; ignore.
            if (e.clientX === 0) return;

            if (!hasMovedEnough) {
                if (Math.abs(e.clientX - dragStartX) > 8) hasMovedEnough = true;
            }
            if (!hasMovedEnough || rafPending) return;

            // Coalesce the (layout-reading) reorder to one per frame.
            const x = e.clientX;
            rafPending = true;
            requestAnimationFrame(() => { rafPending = false; liveReorder(x); });
        };

        const handleDragEnd = () => {
            if (draggedTab) draggedTab.classList.remove('dragging');

            // Clear the cross-pane drag flag. A drop on a split pane already
            // consumed it, but a drag that ends anywhere else must reset it too.
            if (window.SplitEditorManager) {
                window.SplitEditorManager._dragActive = false;
                window.SplitEditorManager._dragSourcePane = null;
            }

            tabsContainer.classList.remove('dragging-active');
            clearTabTransforms();

            // The live reorder already produced the final order — persist it.
            if (draggedTab) this.saveTabOrder();

            draggedTab = null;
            draggedTabPath = null;
            hasMovedEnough = false;
        };

        const handleDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };

        const handleDrop = (e) => {
            e.preventDefault();
            // The live reorder already placed the tab; just clear + finish.
            try { e.dataTransfer.clearData(); } catch (_) { /* ignore */ }
            handleDragEnd();
        };

        const addTabListeners = (tab) => {
            tab.draggable = true;
            tab.addEventListener('dragstart', handleDragStart);
            tab.addEventListener('drag', handleDrag);
            tab.addEventListener('dragend', handleDragEnd);
        };

        // Initialize existing tabs.
        tabsContainer.querySelectorAll('.tab').forEach(addTabListeners);

        // Container-level listeners.
        tabsContainer.addEventListener('dragover', handleDragOver);
        tabsContainer.addEventListener('drop', handleDrop);

        // Auto-wire newly-added tabs (TabManager.addTab inserts them at runtime).
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.matches('.tab')) {
                        addTabListeners(node);
                    }
                });
            });
        });
        observer.observe(tabsContainer, { childList: true });

        // Stored on TabManager so cleanup() can disconnect the observer.
        this.tabObserver = observer;
    },

    // Helper used by callers that need to know which tab a given y-coordinate
    // would insert *after*. Currently unused by initSortableTabs (its own
    // closure-local logic uses x-midpoint), but kept on the public surface
    // because external code may rely on it.
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];

        return draggableElements.reduce(
            (closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset, element: child };
                }
                return closest;
            },
            { offset: Number.NEGATIVE_INFINITY },
        ).element;
    },

    // -- Tab-order persistence -----------------------------------------------

    getTabOrder() {
        const tabContainer = document.getElementById('tabs-container');
        return Array.from(tabContainer.querySelectorAll('.tab'))
            .map((tab) => tab.getAttribute('data-path'));
    },

    saveTabOrder() {
        const tabOrder = this.getTabOrder();
        localStorage.setItem('editorTabOrder', JSON.stringify(tabOrder));
    },

    restoreTabOrder() {
        const savedOrder = localStorage.getItem('editorTabOrder');
        if (!savedOrder) return;

        const tabContainer = document.getElementById('tabs-container');
        const tabOrder = JSON.parse(savedOrder);

        tabOrder.forEach((filePath) => {
            const tab = tabContainer.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
            if (tab) tabContainer.appendChild(tab);
        });
    },
};
