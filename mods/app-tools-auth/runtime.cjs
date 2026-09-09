'use strict';

// Keep the stock verdict unless its specific identity restriction is the failure.
// The native fallback binds the allowed Modex ancestor to this server process.
exports.wrap = function wrap(stock, native) {
  return function authorize(socket) {
    const verdict = stock(socket);
    if (verdict.authorized || verdict.reason !== 'untrusted-code-signing-identity') return verdict;
    const fd = socket._handle?.fd;
    if (!Number.isInteger(fd) || fd < 0) return {authorized: false, reason: 'missing-socket-file-descriptor'};
    try {
      const fallback = native.authorizeSocketPeer(fd);
      return fallback?.authorized === true ? fallback : {authorized: false, reason: fallback?.reason ?? 'modex-peer-rejected'};
    } catch {
      return {authorized: false, reason: 'modex-peer-authorization-failed'};
    }
  };
};
