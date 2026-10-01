/**
 * molde_do_painel.ts: o HTML do painel de IA, montado uma vez no initialize.
 *
 * O cabecalho (historico, tutorial, ajuda, fechar), a lista de mensagens com a
 * dica de conversa vazia, o popover de provedor e modelo, o de historico, o
 * composer e o divisor de largura. Os ids e classes daqui sao os que o painel
 * e os modulos de js/ai procuram depois; mudar um nome aqui pede mudar quem o
 * procura. Os textos com `data-i18n` sao traduzidos depois de montados.
 *
 * Saiu do initialize do ai_assistant_manager.js (TODO 13.3), sem mudar um byte.
 */

import { aiMarkSvg } from '../ui/ai_mark.js';

export function moldeDoPainel(): string {
  return `
      <div class="ai-assistant-header">
        <div class="ai-header-left">
          <span class="ai-assistant-mark">
            <img id="ai-provider-icon" src="./assets/icons/ai_claude.svg" alt="" class="ai-provider-icon">
          </span>
          <h3 class="ai-assistant-title">Aurora Intelligence</h3>
        </div>
        <div class="ai-header-right">
          <button class="ai-hbtn" id="ai-history-btn" title="Chat history" aria-label="Chat history">
            <i class="ph ph-clock-counter-clockwise"></i>
          </button>
          <button class="ai-hbtn" id="ai-tutorial-btn" title="API tutorial" aria-label="API tutorial" data-i18n-title="ai.tutorial.button" data-i18n-aria-label="ai.tutorial.button">
            <i class="ph ph-graduation-cap"></i>
          </button>
          <button class="ai-hbtn" id="ai-clear-btn" title="New chat" aria-label="New chat">
            <i class="ph ph-note-pencil"></i>
          </button>
          <!-- O mesmo "?" dos modais, ao lado do X: o capitulo do manual sobre
               a Aurora Intelligence. O destino mora na tabela de
               js/ui/help_link.js, com os outros. -->
          <button class="ai-hbtn" id="ai-help-btn" title="Open the manual" aria-label="Open the manual" data-i18n-title="ai.help" data-i18n-aria-label="ai.help">
            <i class="ph ph-question"></i>
          </button>
          <span class="ai-hbtn-sep"></span>
          <button class="ai-hbtn ai-hbtn-close" id="ai-close-btn" aria-label="Close AI Assistant" title="Close">
            <i class="ph ph-x"></i>
          </button>
        </div>

        <!-- Chat-history popover: list of saved conversations + "New chat".
             The actual list is populated by refreshChatList(). -->
        <div class="ai-history-popover hidden" id="ai-history-popover" role="menu">
          <div class="ai-history-head">
            <span class="ai-history-title">Chats</span>
            <button class="ai-history-new" id="ai-history-new" title="New chat">
              <i class="ph ph-plus"></i><span>New</span>
            </button>
          </div>
          <div class="ai-history-list" id="ai-history-list"></div>
        </div>
      </div>

      <div class="ai-assistant-content">
        <!-- Aurora gradient glow — concentrated at the TOP of the chat and
             fading downward, so it accents the panel without washing out the
             messages below (a soft, slowly breathing aurora wash). -->
        <div class="ai-aurora-glow" aria-hidden="true"></div>
        <div class="ai-empty-state hidden" id="ai-empty-state">
          <i class="ph ph-sparkle ai-empty-icon" aria-hidden="true"></i>
          <h4 data-i18n="ai.offline.title">Aurora Intelligence is offline</h4>
          <p data-i18n="ai.offline.body">The AI backend could not be reached. Restart Aurora, or open Settings to configure a provider.</p>
        </div>

        <div class="ai-messages" id="ai-messages" role="log" aria-live="polite">
          <div class="ai-chat-empty-hint" id="ai-chat-empty-hint" aria-hidden="true">
            ${aiMarkSvg('ai-empty-hint-mark')}
            <p data-i18n="ai.emptyHint">Ask Aurora Intelligence about your project, Verilog, or SAPHO/CMM</p>
          </div>
        </div>

        <div class="ai-input-area">
          <!-- Model / provider popover — anchored above the composer chip. -->
          <div class="ai-model-popover hidden" id="ai-model-popover" role="menu">
            <div class="ai-mp-section">
              <div class="ai-mp-label" data-i18n="ai.provider">Provider</div>
              <div class="ai-mp-list" id="ai-mp-providers"></div>
            </div>

            <!-- Connection status row — shown for ANY active provider.
                 For Claude Code / ChatGPT it shows CLI install + login + plan;
                 for API providers it shows configured / not configured + model. -->
            <div class="ai-mp-section" id="ai-mp-cc-status"></div>

            <div class="ai-mp-section" id="ai-mp-model-section">
              <div class="ai-mp-label" data-i18n="ai.model">Model</div>
              <div class="ai-mp-modelrow" id="ai-mp-model-api">
                <input type="text" id="ai-model-input" class="ai-mp-model-input"
                       spellcheck="false" autocomplete="off" placeholder="default">
                <button class="ai-mp-iconbtn" id="ai-model-reset" type="button"
                        title="Reset to default model" aria-label="Reset model"
                        data-i18n-title="ai.resetModel">
                  <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
              </div>
              <div class="ai-mp-seg hidden" id="ai-mp-model-presets"></div>
            </div>

            <!-- Effort / reasoning depth (Claude Code only) -->
            <div class="ai-mp-section ai-mp-cc hidden" id="ai-mp-effort-section">
              <div class="ai-mp-label" data-i18n="ai.effort">Effort &amp; reasoning</div>
              <div class="ai-mp-seg" id="ai-mp-effort"></div>
            </div>

            <!-- Subscription usage. For Claude Code these are REAL plan-limit
                 windows (5-hour / 7-day): the Agent SDK streams a per-window
                 utilization percent + reset time as rate_limit_event, read via
                 getClaudeCodeUsage. For Codex the CLI exposes only a session
                 token tally, so it shows one honest session row + a hint. Shown
                 for any subscription provider (ai-mp-cc toggle). -->
            <div class="ai-mp-section ai-mp-usage ai-mp-cc hidden" id="ai-mp-usage">
              <div class="ai-mp-label ai-usage-head">
                <span data-i18n="ai.usage">Usage</span>
                <span class="ai-usage-plan" id="ai-usage-plan"></span>
              </div>
              <div class="ai-usage-bars" id="ai-usage-bars"></div>
            </div>

            <div class="ai-mp-section">
              <div class="ai-mp-label" data-i18n="ai.permissions">Permissions</div>
              <div class="ai-mp-list" id="ai-mp-perms"></div>
            </div>
            <button class="ai-mp-managekeys" id="ai-mp-managekeys" type="button">
              <i class="ph ph-key" aria-hidden="true"></i><span data-i18n="ai.manageKeys">Manage API keys &amp; providers</span>
            </button>
          </div>

          <div class="ai-attachments" id="ai-attachments" hidden></div>
          <div class="ai-msg-queue" id="ai-msg-queue" hidden></div>
          <div class="ai-composer" id="ai-composer">
            <button class="ai-attach-btn" id="ai-attach-btn" type="button"
                    title="Attach files or images" aria-label="Attach files or images"
                    data-i18n-title="ai.attach" data-i18n-aria-label="ai.attach">
              <i class="ph ph-paperclip"></i>
            </button>
            <input type="file" id="ai-attach-input" multiple hidden
                   accept="image/*,text/*,.v,.sv,.svh,.vh,.cmm,.asm,.tasm,.json,.md,.txt,.log,.gtkw,.spf">
            <button class="ai-model-chip" id="ai-model-chip" type="button"
                    title="Switch model or provider" aria-label="Model and provider"
                    data-i18n-title="ai.switchModel">
              <img class="ai-model-chip-icon" id="ai-model-chip-icon"
                   src="./assets/icons/ai_claude.svg" alt="">
              <span class="ai-model-chip-name" id="ai-model-chip-name">Claude</span>
              <i class="ph ph-caret-up-down ai-model-chip-caret"></i>
            </button>

            <textarea id="ai-input"
              class="ai-input"
              placeholder="Ask Aurora Intelligence…"
              data-i18n-placeholder="ai.inputPlaceholder"
              rows="1"
              aria-label="Message"></textarea>

            <span class="ai-token-counter" id="ai-token-counter" title="Tokens this conversation">0</span>

            <button class="ai-stop-btn hidden" id="ai-stop-btn" title="Stop generation" aria-label="Stop"
                    data-i18n-title="ai.stop">
              <i class="ph ph-stop"></i>
            </button>
            <button class="ai-send-btn" id="ai-send-btn" title="Send (Enter)" aria-label="Send"
                    data-i18n-title="ai.send">
              <i class="ph-bold ph-arrow-up"></i>
            </button>
          </div>
        </div>

        <div class="ai-resize-handle" aria-label="Resize AI panel"></div>
      </div>`;
}
