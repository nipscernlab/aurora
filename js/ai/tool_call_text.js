// tool_call_text.js — strip inline tool-call artefacts from model output,
// extracted from ai_assistant_manager.js (A2 god-file decomposition). Some
// models (Llama/Qwen) emit tool calls as inline TEXT — XML <tool_call>/
// <function_calls>/<invoke> blocks, Qwen-style {"name":...,"arguments":...}
// JSON lines, orphan closing tags — instead of structured events. This cleans
// them out before the text is shown to the user or stored in history. Pure
// string -> string (the exact 3-pass chain that was duplicated in 3 call sites).

// Cheap pre-check: does the text contain any tool-call marker at all? When
// false, stripToolCallArtifacts is a guaranteed no-op, so streaming callers
// skip three full-buffer regex scans per frame (the common case — Claude and
// most models never emit these artefacts).
export function mayHaveToolArtifacts(text) {
  return text.indexOf('<') !== -1 || text.indexOf('{"name"') !== -1;
}

// Remove COMPLETE tool-call artefacts only, so a half-streamed tag is left
// intact rather than permanently corrupting the buffer.
export function stripToolCallArtifacts(text) {
  return text
      .replace(/<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g, '')
      .replace(/[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g, '')
      .replace(/<\/tool_call>/g, '');
}
