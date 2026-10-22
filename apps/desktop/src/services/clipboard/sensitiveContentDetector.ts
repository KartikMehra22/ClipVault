/**
 * ClipOrbit — Sensitive Content Detector
 * Phase 5.3: Sensitive-Content Detection and Privacy Protection
 *
 * Deterministic, pure, local-only detector for identifying high-confidence
 * sensitive credentials, private keys, and authentication tokens in clipboard text.
 *
 * PRIVACY GUARANTEES:
 * 1. Strictly local and synchronous. Never performs network calls or IPC invocations.
 * 2. Strictly redacts: never returns or logs matched secrets, excerpts, or derived hashes.
 * 3. Does not store, cache, or persist examined text.
 * 4. Bounded execution: scans at most 65,536 bytes (64 KiB) to prevent regex backtracking stalls.
 *
 * KNOWN FALSE POSITIVES:
 * 1. Sample credentials and documentation: Technical documentation, tutorials, blog posts,
 *    or code snippets containing synthetic example keys (e.g., standard AWS sample keys like
 *    `AKIAIOSFODNN7EXAMPLE`, Stripe test keys `sk_test_...`, or documentation PEM blocks)
 *    will be flagged as sensitive and skipped from capture.
 * 2. Test fixtures and mock suites: Codebases containing fake or unit test secret fixtures
 *    matching valid token structures will trigger detection.
 * 3. Structured text resembling JWTs: Any arbitrary string consisting of three dot-separated
 *    base64url segments starting with `eyJ` will be categorized as a JWT even if it carries
 *    non-secret public metadata or configuration.
 * 4. Config assignments matching sensitive keywords: Setting non-secret placeholders such as
 *    `PASSWORD=placeholder_value_123` will match environment assignment patterns.
 *
 * KNOWN FALSE NEGATIVES & LIMITATIONS:
 * 1. Pattern matching is not exhaustive: Pattern matching CANNOT and DOES NOT detect every
 *    secret. Bespoke, non-standard, or proprietary tokens lacking recognized prefixes or
 *    structured syntactic labels cannot be reliably identified without heuristic guessing.
 * 2. Unlabeled low-entropy passwords: Plaintext passwords copied without an assignment label
 *    (e.g., in conversational chat or standalone lines) cannot be reliably detected by format
 *    alone without causing unacceptable false-positive rates on normal prose.
 * 3. Obfuscated or encoded secrets: Secrets encoded in base64, hexadecimal byte arrays,
 *    split across multiple strings, or passed via URL fragments without standard parameters
 *    will not be recognized.
 * 4. Truncation boundary: Content extending beyond `MAX_SCAN_CHARACTERS` (64 KiB) is not
 *    scanned. Any credential placed strictly past the 64 KiB boundary will not be detected.
 * 5. Non-text data: Images, rich text formatting, or clipboard files containing sensitive
 *    data are outside the scope of this text detector.
 */

import { Buffer } from 'node:buffer';

export type DetectionConfidence = 'high' | 'medium' | 'none';

export type SensitiveCategory =
  | 'private_key'
  | 'aws_credential'
  | 'github_token'
  | 'jwt'
  | 'bearer_token'
  | 'sensitive_env_assignment'
  | 'generic_credential';

export interface SensitiveDetectionResult {
  /** True if high or medium confidence sensitive material was identified. */
  isSensitive: boolean;
  /** Level of confidence in the detection. */
  confidence: DetectionConfidence;
  /** Generic categories of matched items (contains no secret values or excerpts). */
  matchedCategories: SensitiveCategory[];
  /** True if input UTF-8 byte length exceeded the safe scanning limit (64 KiB). */
  exceededScanLimit: boolean;
}

/**
 * Maximum safe UTF-8 byte length scanned by the sensitive content detector.
 * Clamped at 64 KiB (65,536 bytes) to prevent catastrophic regex backtracking (ReDoS).
 * The capture service enforces this as the strict upper bound for all accepted items,
 * ensuring no item is ever retained after examining only a truncated prefix.
 */
export const MAX_SAFE_SCAN_BYTE_LENGTH = 64 * 1024; // 64 KiB = 65,536 bytes

// ============================================================================
// Detection Patterns (Carefully constructed to prevent ReDoS / backtracking)
// ============================================================================

/**
 * 1. Private Key Headers: PEM private key block headers.
 * Matches standard PKCS#1, PKCS#8, OpenSSH, and PGP private key containers.
 */
const PATTERN_PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/;

/**
 * 2. AWS Credentials:
 * - Access Key ID: AKIA / ASIA / ABIA / ACCA prefix followed by 16 alphanumeric characters.
 * - Secret Access Key: explicit assignment to 40-character base64-like secret.
 */
const PATTERN_AWS_ACCESS_KEY = /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/;
const PATTERN_AWS_SECRET_KEY =
  /\b(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i;

/**
 * 3. GitHub Tokens:
 * Standard GitHub prefix formats with fixed lengths.
 */
const PATTERN_GITHUB_PAT_CLASSIC = /\bghp_[A-Za-z0-9]{36}\b/;
const PATTERN_GITHUB_PAT_FINE_GRAINED = /\bgithub_pat_[A-Za-z0-9_]{60,100}\b/;
const PATTERN_GITHUB_OAUTH = /\bgho_[A-Za-z0-9]{36}\b/;
const PATTERN_GITHUB_USER_TO_SERVER = /\bghu_[A-Za-z0-9]{36}\b/;
const PATTERN_GITHUB_SERVER_TO_SERVER = /\bghs_[A-Za-z0-9]{36}\b/;
const PATTERN_GITHUB_REFRESH = /\bghr_[A-Za-z0-9]{36}\b/;

/**
 * 4. JWT-Shaped Values:
 * Three dot-separated base64url segments where the first segment begins with eyJ ({"alg":...).
 */
const PATTERN_JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\b/;

/**
 * 5. Bearer Credentials:
 * Authorization headers or explicit bearer token assignments with significant token length.
 */
const PATTERN_BEARER_AUTH_HEADER =
  /\b(?:authorization|proxy-authorization)\s*:\s*bearer\s+[A-Za-z0-9_.-]{20,}\b/i;
const PATTERN_BEARER_ASSIGNMENT =
  /\b(?:bearer_token|access_token)\s*[:=]\s*["']?(?:bearer\s+)?[A-Za-z0-9_.-]{20,}["']?/i;

/**
 * 6. Explicit Sensitive Environment Variable Assignments:
 * Key-value assignment in env file format or configuration assignment where key is
 * unambiguously a password, secret, token, or database URL with a substantial value.
 */
const PATTERN_ENV_ASSIGNMENT =
  /^\s*(?:export\s+)?(?:[A-Za-z0-9_]*_)?(?:PASSWORD|PASSWD|SECRET|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|DATABASE_URL|DB_PASSWORD|AUTH_TOKEN|BEARER_TOKEN|PRIVATE_KEY)(?:_[A-Za-z0-9_]+)?\s*[:=]\s*["']?[^\s"']{8,}["']?/im;

const PATTERN_JSON_CREDENTIAL_ASSIGNMENT =
  /["'](?:password|secret|api_key|client_secret|access_token|refresh_token|database_url|auth_token|bearer_token)["']\s*:\s*["'][^"'\s]{8,}["']/i;

/**
 * 7. Other Well-Defined Third-Party API Key Formats:
 * - Stripe Secret & Restricted keys: sk_live_, rk_live_, sk_test_, rk_test_ followed by 24+ chars.
 * - Slack User & Bot tokens: xoxb-, xoxp-, xoxa-, xoxr- followed by standard segment lengths.
 */
const PATTERN_STRIPE_KEY = /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/;
const PATTERN_SLACK_TOKEN = /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32}\b/;

/**
 * Inspects plaintext string for high-confidence and medium-confidence sensitive content.
 *
 * @param text The input plaintext string to evaluate.
 * @returns SensitiveDetectionResult containing isSensitive flag, confidence, and generic categories.
 */
export function detectSensitiveContent(text: string): SensitiveDetectionResult {
  if (!text || typeof text !== 'string') {
    return {
      isSensitive: false,
      confidence: 'none',
      matchedCategories: [],
      exceededScanLimit: false,
    };
  }

  // Calculate actual UTF-8 byte length rather than JavaScript string length
  const byteLength = Buffer.byteLength(text, 'utf8');
  const exceededScanLimit = byteLength > MAX_SAFE_SCAN_BYTE_LENGTH;

  // Bound scan length: if called directly on inputs exceeding the safe scanning limit,
  // bound execution to at most MAX_SAFE_SCAN_BYTE_LENGTH UTF-8 bytes to avoid ReDoS.
  // Note: Callers in the capture engine MUST NOT accept or retain any item for which
  // exceededScanLimit is true, as the entire payload has not been verified.
  const boundedText = exceededScanLimit
    ? Buffer.from(text, 'utf8').subarray(0, MAX_SAFE_SCAN_BYTE_LENGTH).toString('utf8')
    : text;

  const categories = new Set<SensitiveCategory>();

  // 1. Check Private Key Headers
  if (PATTERN_PRIVATE_KEY.test(boundedText)) {
    categories.add('private_key');
  }

  // 2. Check AWS Credentials
  if (PATTERN_AWS_ACCESS_KEY.test(boundedText) || PATTERN_AWS_SECRET_KEY.test(boundedText)) {
    categories.add('aws_credential');
  }

  // 3. Check GitHub Tokens
  if (
    PATTERN_GITHUB_PAT_CLASSIC.test(boundedText) ||
    PATTERN_GITHUB_PAT_FINE_GRAINED.test(boundedText) ||
    PATTERN_GITHUB_OAUTH.test(boundedText) ||
    PATTERN_GITHUB_USER_TO_SERVER.test(boundedText) ||
    PATTERN_GITHUB_SERVER_TO_SERVER.test(boundedText) ||
    PATTERN_GITHUB_REFRESH.test(boundedText)
  ) {
    categories.add('github_token');
  }

  // 4. Check JWT
  if (PATTERN_JWT.test(boundedText)) {
    categories.add('jwt');
  }

  // 5. Check Bearer Tokens
  if (PATTERN_BEARER_AUTH_HEADER.test(boundedText) || PATTERN_BEARER_ASSIGNMENT.test(boundedText)) {
    categories.add('bearer_token');
  }

  // 6. Check Sensitive Environment & Configuration Assignments
  if (
    PATTERN_ENV_ASSIGNMENT.test(boundedText) ||
    PATTERN_JSON_CREDENTIAL_ASSIGNMENT.test(boundedText)
  ) {
    categories.add('sensitive_env_assignment');
  }

  // 7. Check Well-Defined Third-Party API Keys
  if (PATTERN_STRIPE_KEY.test(boundedText) || PATTERN_SLACK_TOKEN.test(boundedText)) {
    categories.add('generic_credential');
  }

  const matchedCategories = Array.from(categories);
  const isSensitive = matchedCategories.length > 0;

  // All rules implemented are high-confidence format matches
  const confidence: DetectionConfidence = isSensitive ? 'high' : 'none';

  return {
    isSensitive,
    confidence,
    matchedCategories,
    exceededScanLimit,
  };
}
