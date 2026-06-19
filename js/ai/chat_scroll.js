// chat_scroll.js — pure scroll math for the AI chat viewport, extracted from
// ai_assistant_manager.js (A2 god-file decomposition).
//
// No DOM mutation, no instance state: the AIAssistantManager keeps the scroll
// ORCHESTRATION (it owns messagesEl, stickToBottom and _scrollRaf, and drives
// the requestAnimationFrame loop). These helpers only do the geometry/easing it
// feeds on, so they're unit-testable without a real DOM or a rAF loop.

// Is the viewport within `thresholdPx` of the bottom? A missing element counts
// as "at the bottom" (nothing has scrolled yet). Reads only scrollHeight /
// clientHeight / scrollTop, so a plain object stand-in works in tests.
export function isAtBottom(el, thresholdPx) {
    if (!el) return true;
    return (el.scrollHeight - el.clientHeight - el.scrollTop) <= thresholdPx;
}

// Ease-in-out cubic: accelerate then decelerate. p in [0,1] -> [0,1].
export function easeInOutCubic(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

// Smooth-scroll duration (ms) for a pixel distance: ~half the distance, clamped
// to [240, 560] so short jumps still feel deliberate and long ones don't drag.
export function smoothScrollDuration(dist) {
    return Math.min(560, Math.max(240, dist * 0.5));
}
