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
        let dropIndicator = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let hasMovedEnough = false;

        const createDropIndicator = () => {
            if (dropIndicator) return dropIndicator;
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'drop-indicator';
            tabsContainer.appendChild(dropIndicator);
            return dropIndicator;
        };

        const removeDropIndicator = () => {
            if (dropIndicator) {
                dropIndicator.remove();
                dropIndicator = null;
            }
        };

        const getTabIndex = (tab) =>
            Array.from(tabsContainer.children).indexOf(tab);

        // Determines where the drop indicator should sit and which target tab
        // we'd land relative to. Returns { index, side, tab }.
        const getDropPosition = (x /*, y */) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab:not(.dragging)'));

            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const rect = tab.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;

                if (x < midpoint) {
                    return { index: i, side: 'left', tab };
                }
            }

            // Drop at the end
            return {
                index: tabs.length,
                side: 'right',
                tab: tabs[tabs.length - 1],
            };
        };

        const updateDropIndicator = (dropPosition) => {
            const indicator = createDropIndicator();

            if (!dropPosition.tab) {
                indicator.classList.remove('active');
                return;
            }

            const rect = dropPosition.tab.getBoundingClientRect();
            const containerRect = tabsContainer.getBoundingClientRect();

            const left =
                dropPosition.side === 'left'
                    ? rect.left - containerRect.left - 1
                    : rect.right - containerRect.left - 1;

            indicator.style.left = `${left}px`;
            indicator.classList.add('active');
        };

        const reorderTabs = (draggedPath, targetIndex) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
            const draggedTabElement = tabs.find(
                (tab) => tab.getAttribute('data-path') === draggedPath,
            );
            if (!draggedTabElement) return;

            draggedTabElement.remove();

            if (targetIndex >= tabs.length - 1) {
                tabsContainer.appendChild(draggedTabElement);
            } else {
                const referenceTab = tabs[targetIndex];
                tabsContainer.insertBefore(draggedTabElement, referenceTab);
            }
        };

        const handleDragStart = (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;

            draggedTab = tab;
            draggedTabPath = tab.getAttribute('data-path');
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            hasMovedEnough = false;

            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedTabPath);

            // Flag the drag as an Aurora tab drag originating in the main pane
            // (index 0), so split-pane drop targets accept it and know its
            // source for move semantics. Cleared in handleDragEnd.
            if (window.SplitEditorManager) {
                window.SplitEditorManager._dragActive = true;
                window.SplitEditorManager._dragSourcePane = 0;
            }

            // Suppress the native ghost image — our own .dragging style on
            // the source plus the drop-indicator carry the visual feedback.
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

            // Wait for ~10px of movement before showing the indicator so a
            // simple click doesn't briefly flash one.
            if (!hasMovedEnough) {
                const distance = Math.sqrt(
                    Math.pow(e.clientX - dragStartX, 2) + Math.pow(e.clientY - dragStartY, 2),
                );
                if (distance > 10) hasMovedEnough = true;
            }

            if (hasMovedEnough) {
                const dropPosition = getDropPosition(e.clientX, e.clientY);
                updateDropIndicator(dropPosition);
            }
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
            removeDropIndicator();

            tabsContainer.querySelectorAll('.tab').forEach((tab) => {
                tab.classList.remove('drag-over', 'drag-over-right');
            });

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
            if (!draggedTabPath) return;

            const dropPosition = getDropPosition(e.clientX, e.clientY);

            // Adjust the target index for the slot the dragged tab is leaving.
            let targetIndex = dropPosition.index;
            const currentIndex = getTabIndex(draggedTab);
            if (currentIndex < targetIndex) targetIndex--;

            if (targetIndex !== currentIndex) {
                reorderTabs(draggedTabPath, targetIndex);
                this.saveTabOrder();
            }
            e.dataTransfer.clearData();

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
