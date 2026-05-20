// tooltip.js - Enhanced universal tooltip system for AURORA IDE
document.addEventListener('DOMContentLoaded', () => {
    // Create tooltip element with arrow
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    tooltip.innerHTML = '<div class="tooltip-content"></div><div class="tooltip-arrow"></div>';
    document.body.appendChild(tooltip);
    
    const tooltipContent = tooltip.querySelector('.tooltip-content');
    const tooltipArrow = tooltip.querySelector('.tooltip-arrow');
  
    // Tooltip configuration
    const tooltipConfig = {
        delay: 300,
        duration: 200,
        distance: 12,
        arrowSize: 6
    };
    
    // Track current active element
    let activeElement = null;
    let tooltipTimeout = null;
  
    // Helper to know if tooltips are enabled. Default = true.
    function tooltipsEnabled() {
        return typeof window.AURORA_TOOLTIPS_ENABLED === 'boolean'
            ? window.AURORA_TOOLTIPS_ENABLED
            : true;
    }

    // When aurora-settings toggles tooltips, react here
    window.addEventListener('aurora-tooltips-updated', (ev) => {
        const enabled = ev?.detail?.enabled;
        // If explicitly disabled, make sure tooltip hides and we clear state
        if (enabled === false) {
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
            tooltip.classList.remove('visible');
            tooltip.style.display = 'none';
            activeElement = null;
        } else if (enabled === true) {
            tooltip.style.display = '';
        }
        // If detail is missing, still fallback to global flag check in handlers
    });

    // Single-source tooltips: this module only ever reads `data-tooltip`.
    // Extended descriptions used to live in a separate JS dict and got
    // priority over data-tooltip, which was the source of a bug where the
    // i18n scanner translated `data-tooltip` but the displayed text came
    // from somewhere else. Now i18n.applyDOM() is the single writer of
    // `data-tooltip` (auto-resolved from `tooltip.extended.<id>` for
    // elements with a registered ID), and this module is its single reader.

    // Universal selector for all interactive elements that should have tooltips
    const elementSelectors = [
        'button:not([data-no-tooltip])',
        '[role="button"]:not([data-no-tooltip])',
        '.toolbar-button',
        '.tab',
        '.filter-btn',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="text"]:not(.search-input)',
        'input[type="number"]',
        'select',
        'textarea',
        '.clickable',
        '[data-tooltip]',
        '[title]',
        '.modalConfig-select',
        '.modalConfig-input',
        '.modalConfig-checkbox',
        '.npmodal-btn',
        '.processor-hub-form input',
        '.processor-hub-form select'
    ].join(', ');
  
    // Function to get all relevant elements
    function getAllTooltipElements() {
        // Query everything once and filter out elements explicitly marked to ignore
        const nodeList = document.querySelectorAll(elementSelectors);
        return Array.from(nodeList).filter(el => !el.hasAttribute('data-no-tooltip'));
    }
    
    // Function to get tooltip text for an element
    function getTooltipText(element) {
        const truncateText = (text, maxLength = 250) => {
            if (typeof text !== 'string' || text.length <= maxLength) {
                return text;
            }
            let truncated = text.substring(0, maxLength);
            const lastSpace = truncated.lastIndexOf(' ');
            if (lastSpace > 0) {
                truncated = truncated.substring(0, lastSpace);
            }
            return truncated.trim() + '...';
        };

        let rawText = null;

        // Capture native title text first so the browser tooltip does not compete with Aurora's custom tooltip.
        if (element.title) {
            const titleText = element.title;
            element.removeAttribute('title');
            element.dataset.originalTitle = titleText;
        }

        if (element.dataset.tooltip) {
            rawText = element.dataset.tooltip;
        } else if (element.dataset.originalTitle) {
            rawText = element.dataset.originalTitle;
        } else {
            return null;
        }
        
        return truncateText(rawText);
    }
  
    // Calculate optimal tooltip position
    function calculateTooltipPosition(element, mouseX, mouseY) {
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        const margin = 10;
        const pos = {
            x: 0,
            y: 0,
            arrowDirection: 'bottom'
        };

        pos.x = mouseX - tooltipRect.width / 2;
        pos.y = mouseY - tooltipRect.height - tooltipConfig.distance;
        pos.arrowDirection = 'bottom';

        if (pos.y < margin) {
            pos.y = mouseY + tooltipConfig.distance;
            pos.arrowDirection = 'top';
        }

        if (pos.x < margin) {
            pos.x = margin;
        }

        if (pos.x + tooltipRect.width > viewport.width - margin) {
            pos.x = viewport.width - tooltipRect.width - margin;
        }
        
        return pos;
    }
    
    // Position the tooltip arrow based on tooltip and mouse position
    function positionTooltipArrow(tooltipPos, mouseX) {
        const tooltipRect = tooltip.getBoundingClientRect();
        const arrowHalfWidth = tooltipConfig.arrowSize;
        
        tooltipArrow.className = 'tooltip-arrow';

        let arrowLeft = mouseX - tooltipRect.left - arrowHalfWidth;

        arrowLeft = Math.max(arrowHalfWidth, arrowLeft);
        arrowLeft = Math.min(tooltipRect.width - arrowHalfWidth * 2, arrowLeft);

        if (tooltipPos.arrowDirection === 'top') {
            tooltipArrow.classList.add('arrow-top');
        } else {
            tooltipArrow.classList.add('arrow-bottom');
        }
        
        tooltipArrow.style.left = `${arrowLeft}px`;
    }

    // Add event listeners to all relevant elements
    function addTooltipListeners() {
        const elements = getAllTooltipElements();
        
        elements.forEach(element => {
            // Skip if already has listeners (to avoid duplicates)
            if (element.hasAttribute('data-tooltip-initialized')) {
                return;
            }
            
            element.setAttribute('data-tooltip-initialized', 'true');
            
            element.addEventListener('mouseenter', (e) => handleMouseEnter(e, element));
            element.addEventListener('mouseleave', (e) => handleMouseLeave(e, element));
            element.addEventListener('mousemove', (e) => handleMouseMove(e, element));
        });
    }
    
    // Handle mouse enter
    function handleMouseEnter(e, element) {
        if (!tooltipsEnabled()) return;

        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
        }
        
        const tooltipText = getTooltipText(element);
        if (!tooltipText) {
            return;
        }
        
        tooltipTimeout = setTimeout(() => {
            if (!tooltipsEnabled()) {
                tooltipTimeout = null;
                return;
            }

            tooltipContent.textContent = tooltipText;
            
            positionTooltip(e, element);
            
            tooltip.classList.add('visible');
            activeElement = element;
        }, tooltipConfig.delay);
    }
    
    // Handle mouse leave
 function handleMouseLeave(e, element) {
        // Clear the show timeout if it exists
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }
        
        // If this was the active element, hide tooltip
        if (activeElement === element) {
            tooltip.classList.remove('visible');
            activeElement = null;
        }
    }
    
    // Handle mouse move
    function handleMouseMove(e, element) {
        // Only reposition when visible and enabled
        if (!tooltipsEnabled()) return;
        if (activeElement === element && tooltip.classList.contains('visible')) {
            positionTooltip(e);
        }
    }
    
    // Position the tooltip with improved arrow positioning
    function positionTooltip(e, element) {
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';

        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        const position = calculateTooltipPosition(element, mouseX, mouseY);

        tooltip.style.left = `${position.x}px`;
        tooltip.style.top = `${position.y}px`;
        
        positionTooltipArrow(position, mouseX);

        tooltip.style.visibility = 'visible';
    }

    
    // Initialize tooltips
    addTooltipListeners();
    
    // Re-initialize tooltips when new elements are added to the DOM
    const observer = new MutationObserver((mutations) => {
        let shouldReinitialize = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node or its children match our selectors
                        if (node.matches && node.matches(elementSelectors)) {
                            shouldReinitialize = true;
                        } else if (node.querySelector) {
                            const hasRelevantChildren = node.querySelector(elementSelectors);
                            if (hasRelevantChildren) {
                                shouldReinitialize = true;
                            }
                        }
                    }
                });
            }
        });
        
        if (shouldReinitialize) {
            // Small delay to ensure DOM is fully updated
            setTimeout(addTooltipListeners, 10);
        }
    });
    
    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Hide tooltip on various events
    const hideTooltipEvents = ['resize', 'scroll', 'click', 'keydown'];
    hideTooltipEvents.forEach(eventType => {
        window.addEventListener(eventType, () => {
            if (activeElement) {
                tooltip.classList.remove('visible');
                activeElement = null;
            }
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
        }, eventType === 'scroll' ? true : false);
    });
});

// Handle horizontal scrolling for tabs container
document.addEventListener('DOMContentLoaded', () => {
    const tabsContainer = document.querySelector('.tabs-container');
    if (tabsContainer) {
        tabsContainer.addEventListener('wheel', function(e) {
            if (e.deltaY !== 0) {
                e.preventDefault();
                this.scrollLeft += e.deltaY > 0 ? 50 : -50;
            }
        });
    }
});
