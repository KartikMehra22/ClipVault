/**
 * ClipOrbit — Deterministic Content Classifier
 * Phase 5.1: In-Memory Clipboard Capture Engine
 *
 * Provides fast, deterministic, non-AI heuristics to categorize captured text.
 * Classification serves purely organizational purposes (e.g. UI badges or filters)
 * and is NOT a security determination or secret-detection filter.
 */

import { type ContentCategory } from './types';

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const CODE_KEYWORDS_REGEX =
  /\b(?:const|let|var|function|return|import|export|class|interface|type|extends|implements|public|private|protected|def|elif|lambda|package|struct|func|select|insert|update|delete|from|where)\b/i;

const CODE_SYNTAX_PATTERNS = [
  /=>/, // Arrow functions
  /[{}[\]();]/, // Structural programming punctuation
  /<\/?(?:div|span|p|a|html|body|script|style|table|tr|td|h[1-6]|ul|ol|li)[^>]*>/i, // HTML tags
  /^\s*(?:\/\/|#|\/\*|\*)/m, // Comments
  /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+[A-Za-z*]/i, // SQL queries
];

/**
 * Checks whether the text is a valid web URL.
 */
function isUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes('\n') || trimmed.includes('\r') || trimmed.includes(' ')) {
    return false;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks whether the text represents an email address.
 */
function isEmail(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes('\n') || trimmed.includes('\r') || trimmed.includes(' ')) {
    return false;
  }
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Checks whether the text looks like code, markup, or structured data (e.g. JSON/SQL).
 */
function isCodeLike(text: string): boolean {
  const trimmed = text.trim();

  // Try parsing as JSON object or array
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // Continue to heuristic checks
    }
  }

  // Count matches against code syntax patterns
  let patternMatches = 0;
  for (const pattern of CODE_SYNTAX_PATTERNS) {
    if (pattern.test(trimmed)) {
      patternMatches += 1;
    }
  }

  const hasKeywords = CODE_KEYWORDS_REGEX.test(trimmed);
  const lines = trimmed.split('\n');
  const isMultiLine = lines.length > 1;

  // Multiple lines with indentation and keywords or code symbols
  if (isMultiLine) {
    const indentedLines = lines.filter((l) => /^\s{2,}|\t/.test(l)).length;
    if (indentedLines >= 1 && (hasKeywords || patternMatches >= 1)) {
      return true;
    }
    if (hasKeywords && patternMatches >= 1) {
      return true;
    }
  } else {
    // Single line code: e.g. "const x = 42;" or "console.log('hi')"
    if (hasKeywords && patternMatches >= 1) {
      return true;
    }
  }

  return false;
}

/**
 * Categorizes the given text content using deterministic heuristics.
 *
 * Evaluation order:
 * 1. URL
 * 2. Email
 * 3. Code
 * 4. Text (default fallback)
 */
export function classifyText(text: string): ContentCategory {
  if (!text || typeof text !== 'string') {
    return 'text';
  }

  if (isUrl(text)) {
    return 'url';
  }

  if (isEmail(text)) {
    return 'email';
  }

  if (isCodeLike(text)) {
    return 'code';
  }

  return 'text';
}
