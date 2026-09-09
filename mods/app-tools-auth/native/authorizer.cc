#include <node_api.h>
#include <Security/Security.h>
#include <bsm/libbsm.h>
#include <libproc.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cmath>
#include <cstring>
#include <limits>

#ifndef MODEX_HOST_TEAM_ID
#error A fixed host signing team is required
#endif
#ifndef MODEX_HOST_BUNDLE_ID
#error A fixed host bundle identifier is required
#endif

namespace {
template <typename T> struct Owned {
  T value = nullptr;
  ~Owned() { if (value) CFRelease(value); }
  Owned() = default;
  Owned(const Owned&) = delete;
  Owned& operator=(const Owned&) = delete;
};

bool peerToken(int fd, audit_token_t& token) {
  socklen_t size = sizeof(token);
  return getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) == 0 &&
         size == sizeof(token) && audit_token_to_pid(token) > 1;
}

bool processInfo(pid_t pid, proc_bsdinfo& info) {
  return pid > 1 &&
         proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info) &&
         info.pbi_pid == static_cast<uint32_t>(pid) &&
         !(info.pbi_flags & PROC_FLAG_INEXIT);
}

bool sameProcess(const proc_bsdinfo& a, const proc_bsdinfo& b) {
  return a.pbi_pid == b.pbi_pid && a.pbi_ppid == b.pbi_ppid &&
         a.pbi_start_tvsec == b.pbi_start_tvsec &&
         a.pbi_start_tvusec == b.pbi_start_tvusec;
}

bool guest(CFStringRef key, CFTypeRef value, SecCodeRef* code) {
  const void* keys[] = {key};
  const void* values[] = {value};
  Owned<CFDictionaryRef> attributes;
  attributes.value = CFDictionaryCreate(nullptr, keys, values, 1,
      &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  return attributes.value && SecCodeCopyGuestWithAttributes(nullptr, attributes.value,
      kSecCSDefaultFlags, code) == errSecSuccess;
}

bool valid(SecCodeRef code, CFStringRef expression) {
  Owned<SecRequirementRef> requirement;
  return SecRequirementCreateWithString(expression, kSecCSDefaultFlags,
             &requirement.value) == errSecSuccess &&
         SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement.value) == errSecSuccess;
}

const char* authorize(int fd) {
  audit_token_t token{};
  if (!peerToken(fd, token)) return "peer-token-unavailable";
  const pid_t peerPid = audit_token_to_pid(token);
  const pid_t hostPid = getpid();
  if (peerPid == hostPid) return "invalid-process-chain";

  // Security resolves the socket's audit token, including its PID generation.
  // Never replace this lookup with the reusable numeric peer PID.
  Owned<CFDataRef> audit;
  audit.value = CFDataCreate(nullptr, reinterpret_cast<const UInt8*>(&token), sizeof(token));
  Owned<SecCodeRef> peer;
  if (!audit.value || !guest(kSecGuestAttributeAudit, audit.value, &peer.value))
    return "peer-code-unavailable";
  const auto nodeRequirement = CFSTR("anchor apple generic and identifier \"node\" and certificate leaf[subject.OU] = \"2DC432GLL2\"");
  if (!valid(peer.value, nodeRequirement)) return "peer-signature-invalid";

  proc_bsdinfo peerBefore{}, parentBefore{};
  if (!processInfo(peerPid, peerBefore)) return "peer-process-unavailable";
  const pid_t parentPid = static_cast<pid_t>(peerBefore.pbi_ppid);
  if (parentPid == hostPid || parentPid == peerPid || !processInfo(parentPid, parentBefore))
    return "invalid-process-chain";
  if (parentBefore.pbi_ppid != static_cast<uint32_t>(hostPid)) return "unrelated-host";

  // The child must retain this parent throughout validation. If the parent exits,
  // the child is reparented; the final snapshots reject that and PID reuse.
  Owned<CFNumberRef> parentNumber;
  parentNumber.value = CFNumberCreate(nullptr, kCFNumberIntType, &parentPid);
  Owned<SecCodeRef> parent;
  if (!parentNumber.value || !guest(kSecGuestAttributePid, parentNumber.value, &parent.value))
    return "parent-code-unavailable";
  const auto codexRequirement = CFSTR("anchor apple generic and identifier \"codex\" and certificate leaf[subject.OU] = \"2DC432GLL2\"");
  if (!valid(parent.value, codexRequirement)) return "parent-signature-invalid";

  Owned<SecCodeRef> host;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &host.value) != errSecSuccess)
    return "host-code-unavailable";
  const auto hostRequirement = CFSTR("anchor apple generic and identifier \"" MODEX_HOST_BUNDLE_ID "\" and certificate leaf[subject.OU] = \"" MODEX_HOST_TEAM_ID "\"");
  if (!valid(host.value, hostRequirement)) return "host-signature-invalid";

  // Recheck dynamic validity after all three identities have been established.
  // An exec or invalidation during the check must not preserve authorization.
  if (!valid(peer.value, nodeRequirement) || !valid(parent.value, codexRequirement) ||
      !valid(host.value, hostRequirement)) return "signature-changed";
  proc_bsdinfo peerAfter{}, parentAfter{};
  audit_token_t tokenAfter{};
  if (!processInfo(peerPid, peerAfter) || !processInfo(parentPid, parentAfter) ||
      !sameProcess(peerBefore, peerAfter) || !sameProcess(parentBefore, parentAfter) ||
      !peerToken(fd, tokenAfter) || std::memcmp(&token, &tokenAfter, sizeof(token)) != 0)
    return "process-chain-changed";
  return nullptr;
}

napi_value result(napi_env env, const char* reason) {
  napi_value object, authorized, message;
  if (napi_create_object(env, &object) != napi_ok ||
      napi_get_boolean(env, reason == nullptr, &authorized) != napi_ok ||
      napi_create_string_utf8(env, reason ? reason : "authorized", NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_set_named_property(env, object, "authorized", authorized) != napi_ok ||
      napi_set_named_property(env, object, "reason", message) != napi_ok) {
    napi_throw_error(env, nullptr, "Cannot construct native authorization result");
    return nullptr;
  }
  return object;
}

napi_value authorizeSocketPeer(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  double fd = -1;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_double(env, args[0], &fd) != napi_ok || !std::isfinite(fd) ||
      fd < 0 || fd > std::numeric_limits<int>::max() || std::floor(fd) != fd)
    return result(env, "invalid-descriptor");
  return result(env, authorize(static_cast<int>(fd)));
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor property = {"authorizeSocketPeer", nullptr, authorizeSocketPeer,
      nullptr, nullptr, nullptr, napi_default, nullptr};
  if (napi_define_properties(env, exports, 1, &property) != napi_ok) return nullptr;
  return exports;
}
} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
