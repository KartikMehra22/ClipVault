import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedFrame } from '../dist/main/security.js';

const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

test('isAuthorizedFrame - accepts expected development origin for main frame', () => {
  // Exact origin
  assert.equal(
    isAuthorizedFrame({ url: 'http://127.0.0.1:3000', parent: null }, ALLOWED_ORIGIN),
    true,
  );

  // Exact origin with trailing slash
  assert.equal(
    isAuthorizedFrame({ url: 'http://127.0.0.1:3000/', parent: null }, ALLOWED_ORIGIN),
    true,
  );

  // Subpath and query parameters on allowed origin
  assert.equal(
    isAuthorizedFrame(
      { url: 'http://127.0.0.1:3000/settings?tab=general', parent: null },
      ALLOWED_ORIGIN,
    ),
    true,
  );
});

test('isAuthorizedFrame - rejects unexpected origin', () => {
  // Untrusted external domain
  assert.equal(
    isAuthorizedFrame({ url: 'https://malicious-site.com', parent: null }, ALLOWED_ORIGIN),
    false,
  );

  // Different protocol/hostname attempting spoofing
  assert.equal(
    isAuthorizedFrame({ url: 'http://evil.127.0.0.1.nip.io:3000', parent: null }, ALLOWED_ORIGIN),
    false,
  );

  // Localhost hostname with different origin than 127.0.0.1
  assert.equal(
    isAuthorizedFrame({ url: 'http://localhost:3000', parent: null }, ALLOWED_ORIGIN),
    false,
  );
});

test('isAuthorizedFrame - rejects child frames and iframes', () => {
  // Child frame with matching origin (non-null parent)
  assert.equal(
    isAuthorizedFrame({ url: 'http://127.0.0.1:3000', parent: {} }, ALLOWED_ORIGIN),
    false,
  );

  // Nested frame with arbitrary parent reference
  assert.equal(
    isAuthorizedFrame(
      { url: 'http://127.0.0.1:3000/embed', parent: { id: 'frame-1' } },
      ALLOWED_ORIGIN,
    ),
    false,
  );
});

test('isAuthorizedFrame - rejects invalid or missing URLs', () => {
  // Malformed URL string
  assert.equal(isAuthorizedFrame({ url: 'not-a-valid-url', parent: null }, ALLOWED_ORIGIN), false);

  // Empty string
  assert.equal(isAuthorizedFrame({ url: '', parent: null }, ALLOWED_ORIGIN), false);

  // Null URL
  assert.equal(isAuthorizedFrame({ url: null, parent: null }, ALLOWED_ORIGIN), false);

  // Null frame object
  assert.equal(isAuthorizedFrame(null, ALLOWED_ORIGIN), false);

  // Undefined frame object
  assert.equal(isAuthorizedFrame(undefined, ALLOWED_ORIGIN), false);
});

test('isAuthorizedFrame - rejects different port', () => {
  // Port 3001
  assert.equal(
    isAuthorizedFrame({ url: 'http://127.0.0.1:3001', parent: null }, ALLOWED_ORIGIN),
    false,
  );

  // Port 8080
  assert.equal(
    isAuthorizedFrame({ url: 'http://127.0.0.1:8080', parent: null }, ALLOWED_ORIGIN),
    false,
  );

  // Default HTTP port 80
  assert.equal(
    isAuthorizedFrame({ url: 'http://127.0.0.1:80', parent: null }, ALLOWED_ORIGIN),
    false,
  );
});
