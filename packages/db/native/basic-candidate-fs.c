#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/fs.h>
#include <node_api.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#define BASIC_COMPONENT_MAX_BYTES 255U

typedef struct {
  char bytes[BASIC_COMPONENT_MAX_BYTES + 1U];
} basic_component;

static napi_value make_status(napi_env env, const char *status) {
  napi_value result = NULL;
  if (napi_create_string_utf8(env, status, NAPI_AUTO_LENGTH, &result) != napi_ok) {
    return NULL;
  }
  return result;
}

static int read_directory_fd(napi_env env, napi_value value, int *result) {
  napi_valuetype type = napi_undefined;
  double raw_fd = 0.0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number ||
      napi_get_value_double(env, value, &raw_fd) != napi_ok ||
      !(raw_fd >= 0.0 && raw_fd <= (double)INT_MAX)) {
    return 0;
  }
  *result = (int)raw_fd;
  return (double)*result == raw_fd;
}

static int read_component(napi_env env, napi_value value, basic_component *result) {
  napi_valuetype type = napi_undefined;
  size_t length = 0U;
  size_t written = 0U;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, value, NULL, 0U, &length) != napi_ok ||
      length == 0U || length > BASIC_COMPONENT_MAX_BYTES ||
      napi_get_value_string_utf8(
        env,
        value,
        result->bytes,
        sizeof(result->bytes),
        &written
      ) != napi_ok || written != length ||
      memchr(result->bytes, '\0', length) != NULL) {
    return 0;
  }
  result->bytes[length] = '\0';
  if (strcmp(result->bytes, ".") == 0 || strcmp(result->bytes, "..") == 0) {
    return 0;
  }
  for (size_t index = 0U; index < length; index += 1U) {
    if (result->bytes[index] == '/' || result->bytes[index] == '\\') {
      return 0;
    }
  }
  return 1;
}

static const char *failure_status(int error_number) {
  switch (error_number) {
    case EEXIST:
      return "ERR_EXISTS";
    case ENOSYS:
    case EINVAL:
    case EOPNOTSUPP:
      return "ERR_UNSUPPORTED";
    case EPERM:
    case EACCES:
      return "ERR_DENIED";
    default:
      return "ERR_FAILED";
  }
}

static napi_value rename_no_replace(napi_env env, napi_callback_info info) {
  size_t argument_count = 4U;
  napi_value arguments[4] = {NULL, NULL, NULL, NULL};
  int parent_fd = -1;
  basic_component old_name = {{0}};
  basic_component new_name = {{0}};
  struct stat parent_details;

  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 3U ||
      !read_directory_fd(env, arguments[0], &parent_fd) ||
      !read_component(env, arguments[1], &old_name) ||
      !read_component(env, arguments[2], &new_name)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstat(parent_fd, &parent_details) != 0) {
    return make_status(env, failure_status(errno));
  }
  if (!S_ISDIR(parent_details.st_mode)) {
    return make_status(env, "ERR_INVALID");
  }

#ifdef SYS_renameat2
  if (syscall(
        SYS_renameat2,
        parent_fd,
        old_name.bytes,
        parent_fd,
        new_name.bytes,
        RENAME_NOREPLACE
      ) == 0) {
    return make_status(env, "OK");
  }
  return make_status(env, failure_status(errno));
#else
  return make_status(env, "ERR_UNSUPPORTED");
#endif
}

NAPI_MODULE_INIT() {
  napi_value operation = NULL;
  if (napi_create_function(
        env,
        "renameNoReplace",
        NAPI_AUTO_LENGTH,
        rename_no_replace,
        NULL,
        &operation
      ) != napi_ok ||
      napi_set_named_property(env, exports, "renameNoReplace", operation) != napi_ok) {
    return NULL;
  }
  return exports;
}
