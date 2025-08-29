/**
 * =====================================================================================
 * Modern Interactive Notification Stack System (v3 - Smoother Animations)
 *
 * Description: A self-contained, globally accessible notification system that displays
 *              messages in an interactive, cascading stack with refined animations
 *              and hover-to-pause functionality.
 *
 * Key Features:
 * - Interactive cascading stack at the bottom-left.
 * - Hovering expands the stack for easy reading.
 * - Hovering over any card pauses its dismiss timer and progress bar.
 * - [RENEWED] Smoother, more fluid entrance, exit, and stacking animations.
 * - Dismissing any notification causes the stack to animate and reorganize.
 *
 * How to Use:
 * 1. Include this script in your project.
 * 2. Call the global function from anywhere:
 *    showCardNotification('Your message here.', 'success', 5000);
 *
 * =====================================================================================
 */
(function() {
    let notificationContainer = null;
    const MAX_VISIBLE_NOTIFICATIONS = 3;

    function injectStyles() {
        if (document.getElementById('modern-notification-styles-stack')) return;

        if (!document.querySelector('link[href*="fontawesome"]')) {
            const fontAwesomeLink = document.createElement('link');
            fontAwesomeLink.rel = 'stylesheet';
            fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
            document.head.appendChild(fontAwesomeLink);
        }

        const css = `
            #notification-stack-container {
                position: fixed;
                bottom: var(--space-6, 24px);
                left: var(--space-6, 24px);
                width: 400px;
                max-width: calc(100% - var(--space-8, 32px));
                z-index: var(--z-50, 50);
                /* [RENEWED] Smoother transition for container height changes */
                transition: height 400ms cubic-bezier(0.4, 0, 0.2, 1);
            }

            .notification-card {
                position: absolute;
                bottom: 50px;
                left: 0;
                width: 100%;
                will-change: transform, opacity;
                pointer-events: all;
                display: flex;
                background-color: var(--bg-elevated, #222029);
                border-radius: var(--radius-lg, 16px);
                border: 1px solid var(--border-primary, #3A3842);
                box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.6));
                color: var(--text-primary, #EAEAEA);
                overflow: hidden;

                --index: 0; 
                transform-origin: bottom center;
                
                /* Default stacked state */
                transform: 
                    translateY(calc(var(--index) * -14px)) /* Slightly more separation */
                    scale(calc(1 - 0.05 * var(--index)));
                opacity: calc(1 - 0.2 * var(--index));
                z-index: calc(100 - var(--index));

                /* [RENEWED] Main transition for all animations for a fluid feel */
                transition: transform 400ms cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 400ms cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .notification-card:nth-child(n+${MAX_VISIBLE_NOTIFICATIONS + 1}) {
                opacity: 0;
                pointer-events: none;
            }

            /* [RENEWED] Smoother Entrance Animation: Fades and slides up from bottom */
            .notification-card.enter-start {
                opacity: 0;
                transform: translateY(20px) scale(0.95);
            }
            
            /* [RENEWED] Smoother Exit Animation: Fades and slides down */
            .notification-card.exit {
                opacity: 0 !important;
                transform: translateY(10px) scale(0.9) !important;
                transition-duration: var(--transition-fast, 200ms); /* Slightly slower for visibility */
            }

            /* [RENEWED] Smoother stack unpacking on hover */
            #notification-stack-container:hover .notification-card {
                 /* Unpack with a subtle vertical offset */
                transform: translateY(calc(var(--index) * -110% - (var(--index) * 10px)));
                opacity: 1;
                /* Stagger the animation for a more dynamic feel */
                transition-delay: calc(var(--index) * 30ms);
            }

            /* (Card content styles are identical) */
            .notification-sidebar { flex-shrink: 0; width: var(--space-12, 48px); display: flex; align-items: center; justify-content: center; font-size: var(--text-xl, 20px); color: var(--text-on-accent, #FFFFFF); }
            .notification-content { padding: var(--space-4, 16px); flex-grow: 1; }
            .notification-title { font-weight: var(--font-semibold, 600); font-size: var(--text-base, 16px); margin-bottom: var(--space-1, 4px); }
            .notification-message { font-size: var(--text-sm, 14px); color: var(--text-secondary, #C0C0C0); line-height: var(--leading-normal, 1.5); }
            .notification-close { position: absolute; top: var(--space-2, 8px); right: var(--space-2, 8px); width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-full, 9999px); cursor: pointer; transition: background-color var(--transition-fast, 150ms); color: var(--text-tertiary, #8F8F8F); z-index: 10; }
            .notification-close:hover { background-color: var(--overlay-hover, rgba(255, 255, 255, 0.07)); color: var(--text-primary, #EAEAEA); }
            .notification-progress { position: absolute; bottom: 0; left: 0; height: 3px; width: 100%; transition: none; /* Transition is managed by JS */ }
            .notification-card.success .notification-sidebar, .notification-card.success .notification-progress { background-color: var(--status-success, #27ae60); }
            .notification-card.error .notification-sidebar, .notification-card.error .notification-progress { background-color: var(--status-error, #e74c3c); }
            .notification-card.warning .notification-sidebar, .notification-card.warning .notification-progress { background-color: var(--status-warning, #f39c12); }
            .notification-card.info .notification-sidebar, .notification-card.info .notification-progress { background-color: var(--status-info, #3498db); }
        `;
        const styleElement = document.createElement('style');
        styleElement.id = 'modern-notification-styles-stack';
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
    }

    function createContainer() {
        if (notificationContainer) return;
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-stack-container';
        document.body.appendChild(notificationContainer);
    }

    function updateStack() {
        const cards = Array.from(notificationContainer.children);
        cards.forEach((card, index) => {
            card.style.setProperty('--index', index);
        });
        
        if (cards.length > 0) {
             const topCardHeight = cards[0].offsetHeight;
             const totalHeight = topCardHeight + (Math.min(cards.length - 1, MAX_VISIBLE_NOTIFICATIONS - 1) * (topCardHeight + 12));
             notificationContainer.style.height = `${totalHeight}px`;
        } else {
             notificationContainer.style.height = '0px';
        }
    }

    function showCardNotification(message, type = 'info', duration = 5000) {
        injectStyles();
        createContainer();

        const card = document.createElement('div');
        card.className = 'notification-card enter-start';
        card.innerHTML = `
            <div class="notification-sidebar"> <i class="notification-icon fa-solid"></i> </div>
            <div class="notification-content"> <div class="notification-title"></div> <div class="notification-message"></div> </div>
            <div class="notification-close"> <i class="fa-solid fa-xmark"></i> </div>
            <div class="notification-progress"></div>
        `;

        const config = {
            success: { icon: 'fa-check', title: 'Success', theme: 'success' },
            error: { icon: 'fa-bolt', title: 'Error', theme: 'error' },
            warning: { icon: 'fa-triangle-exclamation', title: 'Warning', theme: 'warning' },
            info: { icon: 'fa-circle-info', title: 'Information', theme: 'info' }
        };
        const currentConfig = config[type] || config.info;

        card.classList.add(currentConfig.theme);
        card.querySelector('.notification-title').textContent = currentConfig.title;
        card.querySelector('.notification-message').innerHTML = message;
        card.querySelector('.notification-icon').classList.add(currentConfig.icon);
        
        notificationContainer.prepend(card);
        updateStack();

        requestAnimationFrame(() => card.classList.remove('enter-start'));
        
        // --- [NEW] Refined Timer and Progress Bar Logic ---
        const progressBar = card.querySelector('.notification-progress');
        let timerId;
        let startTime = Date.now();
        let remainingTime = duration;

        const resume = () => {
            startTime = Date.now();
            clearTimeout(timerId);
            timerId = setTimeout(dismiss, remainingTime);

            // Resume progress bar animation
            progressBar.style.transition = `width ${remainingTime}ms linear`;
            progressBar.style.width = '0%';
        };

        const pause = () => {
            clearTimeout(timerId);
            remainingTime -= Date.now() - startTime;

            // Pause progress bar animation
            const computedWidth = getComputedStyle(progressBar).width;
            progressBar.style.transition = 'none';
            progressBar.style.width = computedWidth;
        };

        const dismiss = () => {
            if (card.dismissing) return;
            card.dismissing = true;
            pause();
            card.classList.add('exit');
            card.addEventListener('transitionend', () => {
                card.remove();
                updateStack();
            }, { once: true });
        };
        
        card.querySelector('.notification-close').addEventListener('click', dismiss);
        card.addEventListener('mouseenter', pause);
        card.addEventListener('mouseleave', resume);

        // Start the timer for the first time
        resume();
    }
    
    window.showCardNotification = showCardNotification;

})();