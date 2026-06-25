import { findExternalToolByName } from './registry.js';

export function stripFunctionCallMarkup(text, trim = true) {
  if (!text) return text;
  const cleaned = text
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<\/?function_calls>/g, '');
  return trim ? cleaned.trim() : cleaned;
}

const BARE_JSON_TOOL_RE = /{(?:\s*"[^"]+"\s*:\s*"[^"]*"\s*,?\s*)*"name"\s*:\s*"[^"]+"/;

function tryParseJsonAsToolCall(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    const rawCalls = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tool_calls)
        ? parsed.tool_calls
        : [parsed];
    return rawCalls.filter((rc) => rc?.name || rc?.function?.name);
  } catch { return null; }
}

export function parseToolCallsFromText(...chunks) {
  const matches = [];
  chunks.forEach((chunk) => {
    if (!chunk || typeof chunk !== 'string') return;
    // 1) First, try matching <function_calls> wrapped blocks
    const blocks = chunk.matchAll(/<function_calls>([\s\S]*?)<\/function_calls>/g);
    let foundWrapped = false;
    for (const block of blocks) {
      const payload = block?.[1]?.trim();
      if (!payload) continue;
      const rawCalls = tryParseJsonAsToolCall(payload);
      if (!rawCalls) continue;
      foundWrapped = true;
      rawCalls.forEach((rawCall, index) => {
        const name = rawCall?.function?.name || rawCall?.name;
        const rawArgs = rawCall?.function?.arguments ?? rawCall?.arguments ?? {};
        if (!name) return;
        matches.push({
          id: rawCall?.id || `call_${Date.now()}_${matches.length + index + 1}`,
          type: 'function',
          function: {
            name,
            arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs)
          }
        });
      });
    }
    // 2) If no <function_calls> blocks found, fallback: try bare JSON object(s)
    //    matching pattern like {"name":"external__xxx","arguments":{...}}
    if (!foundWrapped) {
      let searchPos = 0;
      while (searchPos < chunk.length) {
        const braceStart = chunk.indexOf('{', searchPos);
        if (braceStart === -1) break;
        let depth = 0;
        let braceEnd = -1;
        for (let i = braceStart; i < chunk.length; i++) {
          if (chunk[i] === '{') depth++;
          else if (chunk[i] === '}') {
            depth--;
            if (depth === 0) { braceEnd = i; break; }
          }
        }
        if (braceEnd === -1) break;
        const jsonCandidate = chunk.slice(braceStart, braceEnd + 1);
        const rawCalls = tryParseJsonAsToolCall(jsonCandidate);
        if (rawCalls) {
          rawCalls.forEach((rawCall, index) => {
            const name = rawCall?.function?.name || rawCall?.name;
            const rawArgs = rawCall?.function?.arguments ?? rawCall?.arguments ?? {};
            if (!name) return;
            matches.push({
              id: rawCall?.id || `call_${Date.now()}_${matches.length + index + 1}`,
              type: 'function',
              function: {
                name,
                arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs)
              }
            });
          });
        }
        searchPos = braceEnd + 1;
      }
    }
  });
  return matches;
}

export function parseExternalToolCallsFromText(registry, ...chunks) {
  if (!Array.isArray(registry) || registry.length === 0) return [];
  const rawCalls = parseToolCallsFromText(...chunks);
  const counts = new Map();
  return rawCalls.flatMap((rawCall) => {
    const tool = findExternalToolByName(registry, rawCall?.function?.name);
    if (!tool) return [];
    const nextCount = (counts.get(tool.namespacedName) || 0) + 1;
    counts.set(tool.namespacedName, nextCount);
    return [{
      id: rawCall.id || `call_${tool.namespacedName.replace(/[^a-zA-Z0-9_]/g, '_')}_${nextCount}`,
      type: 'function',
      function: {
        name: tool.originalName,
        arguments: rawCall.function.arguments
      }
    }];
  });
}

export function createToolCallFilter({ disableTools, forceStrip = false }) {
  if (!disableTools && !forceStrip) return (chunk) => chunk;
  let inBlock = false;
  return (chunk) => {
    if (!chunk) return chunk;
    let output = '';
    let remaining = chunk;
    while (remaining.length) {
      if (inBlock) {
        const endIdx = remaining.indexOf('</function_calls>');
        if (endIdx === -1) {
          return output;
        }
        remaining = remaining.slice(endIdx + '</function_calls>'.length);
        inBlock = false;
        continue;
      }
      const startIdx = remaining.indexOf('<function_calls>');
      if (startIdx === -1) {
        output += remaining;
        return output;
      }
      output += remaining.slice(0, startIdx);
      remaining = remaining.slice(startIdx + '<function_calls>'.length);
      inBlock = true;
    }
    return output;
  };
}

export function createExternalToolCallStreamParser(registry) {
  if (!Array.isArray(registry) || registry.length === 0) {
    return () => [];
  }
  const openTag = '<function_calls>';
  const closeTag = '</function_calls>';
  let buffer = '';
  return (chunk) => {
    if (!chunk) return [];
    buffer += chunk;
    const parsedCalls = [];
    while (buffer.length) {
      const startIdx = buffer.indexOf(openTag);
      if (startIdx === -1) {
        buffer = buffer.slice(-(openTag.length - 1));
        break;
      }
      const endIdx = buffer.indexOf(closeTag, startIdx + openTag.length);
      if (endIdx === -1) {
        buffer = buffer.slice(startIdx);
        break;
      }
      const block = buffer.slice(startIdx, endIdx + closeTag.length);
      parsedCalls.push(...parseExternalToolCallsFromText(registry, block));
      buffer = buffer.slice(endIdx + closeTag.length);
    }
    return parsedCalls;
  };
}
