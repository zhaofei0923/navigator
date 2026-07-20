#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/fs.h>
#include <node_api.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#define BASIC_COMPONENT_MAX_BYTES 255U
#define BASIC_PRIVATE_DIRECTORY_MODE 0700U
#define BASIC_REPOSITORY_DATA_MODE 0755U

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

static int read_identity(napi_env env, napi_value value, uint64_t *result) {
  bool lossless = false;
  return napi_get_value_bigint_uint64(env, value, result, &lossless) == napi_ok && lossless;
}

static int read_directory_mode(napi_env env, napi_value value, mode_t *result) {
  uint32_t raw_mode = 0U;
  if (napi_get_value_uint32(env, value, &raw_mode) != napi_ok ||
      (raw_mode != BASIC_PRIVATE_DIRECTORY_MODE &&
       raw_mode != BASIC_REPOSITORY_DATA_MODE)) {
    return 0;
  }
  *result = (mode_t)raw_mode;
  return 1;
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

static int same_directory(const struct stat *left, const struct stat *right) {
  return S_ISDIR(left->st_mode) && S_ISDIR(right->st_mode) &&
    left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int valid_hierarchy_directory(const struct stat *details, mode_t policy) {
  mode_t permissions = details->st_mode & 0777U;
  if (!S_ISDIR(details->st_mode) || details->st_uid != geteuid()) {
    return 0;
  }
  if (policy == BASIC_PRIVATE_DIRECTORY_MODE) {
    return permissions == BASIC_PRIVATE_DIRECTORY_MODE;
  }
  return policy == BASIC_REPOSITORY_DATA_MODE &&
    (permissions & 0700U) == 0700U && (permissions & 0022U) == 0U;
}

static napi_value make_created_directory(
  napi_env env,
  int directory_fd,
  const struct stat *details
) {
  napi_value result = NULL;
  napi_value fd_value = NULL;
  napi_value dev_value = NULL;
  napi_value ino_value = NULL;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_int32(env, directory_fd, &fd_value) != napi_ok ||
      napi_create_bigint_uint64(env, (uint64_t)details->st_dev, &dev_value) != napi_ok ||
      napi_create_bigint_uint64(env, (uint64_t)details->st_ino, &ino_value) != napi_ok ||
      napi_set_named_property(env, result, "fd", fd_value) != napi_ok ||
      napi_set_named_property(env, result, "dev", dev_value) != napi_ok ||
      napi_set_named_property(env, result, "ino", ino_value) != napi_ok) {
    close(directory_fd);
    return make_status(env, "ERR_FAILED");
  }
  return result;
}

static napi_value make_ensured_directory(
  napi_env env,
  int directory_fd,
  const struct stat *details,
  int created
) {
  napi_value result = NULL;
  napi_value fd_value = NULL;
  napi_value dev_value = NULL;
  napi_value ino_value = NULL;
  napi_value created_value = NULL;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_int32(env, directory_fd, &fd_value) != napi_ok ||
      napi_create_bigint_uint64(env, (uint64_t)details->st_dev, &dev_value) != napi_ok ||
      napi_create_bigint_uint64(env, (uint64_t)details->st_ino, &ino_value) != napi_ok ||
      napi_get_boolean(env, created != 0, &created_value) != napi_ok ||
      napi_set_named_property(env, result, "fd", fd_value) != napi_ok ||
      napi_set_named_property(env, result, "dev", dev_value) != napi_ok ||
      napi_set_named_property(env, result, "ino", ino_value) != napi_ok ||
      napi_set_named_property(env, result, "created", created_value) != napi_ok) {
    close(directory_fd);
    return make_status(env, "ERR_FAILED");
  }
  return result;
}

static napi_value open_directory_result(
  napi_env env,
  int parent_fd,
  const basic_component *name,
  int created,
  mode_t policy
) {
  int directory_fd = openat(
    parent_fd,
    name->bytes,
    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
  );
  struct stat opened_details;
  struct stat named_details;
  if (directory_fd < 0 || fstat(directory_fd, &opened_details) != 0 ||
      fstatat(parent_fd, name->bytes, &named_details, AT_SYMLINK_NOFOLLOW) != 0 ||
      !same_directory(&opened_details, &named_details) ||
      !valid_hierarchy_directory(&opened_details, policy)) {
    int saved_error = errno;
    if (directory_fd >= 0) close(directory_fd);
    return make_status(env, failure_status(saved_error));
  }
  return created < 0
    ? make_created_directory(env, directory_fd, &opened_details)
    : make_ensured_directory(env, directory_fd, &opened_details, created);
}

static napi_value create_exclusive_directory(napi_env env, napi_callback_info info) {
  size_t argument_count = 3U;
  napi_value arguments[3] = {NULL, NULL, NULL};
  int parent_fd = -1;
  basic_component name = {{0}};
  struct stat parent_details;

  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 2U ||
      !read_directory_fd(env, arguments[0], &parent_fd) ||
      !read_component(env, arguments[1], &name)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstat(parent_fd, &parent_details) != 0) {
    return make_status(env, failure_status(errno));
  }
  if (!S_ISDIR(parent_details.st_mode)) {
    return make_status(env, "ERR_INVALID");
  }
  if (mkdirat(parent_fd, name.bytes, 0700) != 0) {
    return make_status(env, failure_status(errno));
  }
  return open_directory_result(
    env,
    parent_fd,
    &name,
    -1,
    BASIC_PRIVATE_DIRECTORY_MODE
  );
}

static napi_value ensure_directory(napi_env env, napi_callback_info info) {
  size_t argument_count = 3U;
  napi_value arguments[3] = {NULL, NULL, NULL};
  int parent_fd = -1;
  int created = 0;
  mode_t policy = 0U;
  basic_component name = {{0}};
  struct stat parent_details;

  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 3U ||
      !read_directory_fd(env, arguments[0], &parent_fd) ||
      !read_component(env, arguments[1], &name) ||
      !read_directory_mode(env, arguments[2], &policy)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstat(parent_fd, &parent_details) != 0) {
    return make_status(env, failure_status(errno));
  }
  if (!S_ISDIR(parent_details.st_mode)) {
    return make_status(env, "ERR_INVALID");
  }
  if (mkdirat(parent_fd, name.bytes, 0700) == 0) {
    created = 1;
  } else if (errno != EEXIST) {
    return make_status(env, failure_status(errno));
  }
  return open_directory_result(env, parent_fd, &name, created, policy);
}

static napi_value close_directory(napi_env env, napi_callback_info info) {
  size_t argument_count = 1U;
  napi_value arguments[1] = {NULL};
  int directory_fd = -1;
  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 1U ||
      !read_directory_fd(env, arguments[0], &directory_fd)) {
    return make_status(env, "ERR_INVALID");
  }
  return close(directory_fd) == 0
    ? make_status(env, "OK")
    : make_status(env, failure_status(errno));
}

static napi_value rename_no_replace(napi_env env, napi_callback_info info) {
  size_t argument_count = 5U;
  napi_value arguments[5] = {NULL, NULL, NULL, NULL, NULL};
  int parent_fd = -1;
  uint64_t expected_dev = 0U;
  uint64_t expected_ino = 0U;
  basic_component old_name = {{0}};
  basic_component new_name = {{0}};
  struct stat parent_details;
  struct stat source_details;
  struct stat target_details;

  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 5U ||
      !read_directory_fd(env, arguments[0], &parent_fd) ||
      !read_component(env, arguments[1], &old_name) ||
      !read_component(env, arguments[2], &new_name) ||
      !read_identity(env, arguments[3], &expected_dev) ||
      !read_identity(env, arguments[4], &expected_ino)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstat(parent_fd, &parent_details) != 0) {
    return make_status(env, failure_status(errno));
  }
  if (!S_ISDIR(parent_details.st_mode)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstatat(parent_fd, old_name.bytes, &source_details, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISDIR(source_details.st_mode) ||
      (uint64_t)source_details.st_dev != expected_dev ||
      (uint64_t)source_details.st_ino != expected_ino) {
    return make_status(env, "ERR_FAILED");
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
    if (fstatat(parent_fd, new_name.bytes, &target_details, AT_SYMLINK_NOFOLLOW) != 0 ||
        !S_ISDIR(target_details.st_mode) ||
        (uint64_t)target_details.st_dev != expected_dev ||
        (uint64_t)target_details.st_ino != expected_ino) {
      return make_status(env, "COMMITTED_UNVERIFIED");
    }
    return make_status(env, "OK");
  }
  return make_status(env, failure_status(errno));
#else
  return make_status(env, "ERR_UNSUPPORTED");
#endif
}

static napi_value unlink_regular_file(napi_env env, napi_callback_info info) {
  size_t argument_count = 4U;
  napi_value arguments[4] = {NULL, NULL, NULL, NULL};
  int parent_fd = -1;
  uint64_t expected_dev = 0U;
  uint64_t expected_ino = 0U;
  basic_component name = {{0}};
  struct stat parent_details;
  struct stat child_details;

  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 4U ||
      !read_directory_fd(env, arguments[0], &parent_fd) ||
      !read_component(env, arguments[1], &name) ||
      !read_identity(env, arguments[2], &expected_dev) ||
      !read_identity(env, arguments[3], &expected_ino)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstat(parent_fd, &parent_details) != 0 || !S_ISDIR(parent_details.st_mode)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstatat(parent_fd, name.bytes, &child_details, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISREG(child_details.st_mode) ||
      (uint64_t)child_details.st_dev != expected_dev ||
      (uint64_t)child_details.st_ino != expected_ino) {
    return make_status(env, "ERR_FAILED");
  }
  if (unlinkat(parent_fd, name.bytes, 0) != 0) {
    return make_status(env, failure_status(errno));
  }
  if (fstatat(parent_fd, name.bytes, &child_details, AT_SYMLINK_NOFOLLOW) == 0 ||
      errno != ENOENT) {
    return make_status(env, "ERR_FAILED");
  }
  return make_status(env, "OK");
}

static napi_value remove_directory(napi_env env, napi_callback_info info) {
  size_t argument_count = 4U;
  napi_value arguments[4] = {NULL, NULL, NULL, NULL};
  int parent_fd = -1;
  uint64_t expected_dev = 0U;
  uint64_t expected_ino = 0U;
  basic_component name = {{0}};
  struct stat parent_details;
  struct stat child_details;

  if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok ||
      argument_count != 4U ||
      !read_directory_fd(env, arguments[0], &parent_fd) ||
      !read_component(env, arguments[1], &name) ||
      !read_identity(env, arguments[2], &expected_dev) ||
      !read_identity(env, arguments[3], &expected_ino)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstat(parent_fd, &parent_details) != 0 || !S_ISDIR(parent_details.st_mode)) {
    return make_status(env, "ERR_INVALID");
  }
  if (fstatat(parent_fd, name.bytes, &child_details, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISDIR(child_details.st_mode) ||
      (uint64_t)child_details.st_dev != expected_dev ||
      (uint64_t)child_details.st_ino != expected_ino) {
    return make_status(env, "ERR_FAILED");
  }
  if (unlinkat(parent_fd, name.bytes, AT_REMOVEDIR) != 0) {
    return make_status(env, failure_status(errno));
  }
  if (fstatat(parent_fd, name.bytes, &child_details, AT_SYMLINK_NOFOLLOW) == 0 ||
      errno != ENOENT) {
    return make_status(env, "ERR_FAILED");
  }
  return make_status(env, "OK");
}

NAPI_MODULE_INIT() {
  napi_value create_operation = NULL;
  napi_value ensure_operation = NULL;
  napi_value close_operation = NULL;
  napi_value operation = NULL;
  napi_value unlink_operation = NULL;
  napi_value remove_operation = NULL;
  if (napi_create_function(
        env,
        "createExclusiveDirectory",
        NAPI_AUTO_LENGTH,
        create_exclusive_directory,
        NULL,
        &create_operation
      ) != napi_ok ||
      napi_set_named_property(
        env,
        exports,
        "createExclusiveDirectory",
        create_operation
      ) != napi_ok ||
      napi_create_function(
        env,
        "ensureDirectory",
        NAPI_AUTO_LENGTH,
        ensure_directory,
        NULL,
        &ensure_operation
      ) != napi_ok ||
      napi_set_named_property(env, exports, "ensureDirectory", ensure_operation) != napi_ok ||
      napi_create_function(
        env,
        "closeDirectory",
        NAPI_AUTO_LENGTH,
        close_directory,
        NULL,
        &close_operation
      ) != napi_ok ||
      napi_set_named_property(env, exports, "closeDirectory", close_operation) != napi_ok ||
      napi_create_function(
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
  if (napi_create_function(
        env,
        "unlinkRegularFile",
        NAPI_AUTO_LENGTH,
        unlink_regular_file,
        NULL,
        &unlink_operation
      ) != napi_ok ||
      napi_set_named_property(env, exports, "unlinkRegularFile", unlink_operation) != napi_ok ||
      napi_create_function(
        env,
        "removeDirectory",
        NAPI_AUTO_LENGTH,
        remove_directory,
        NULL,
        &remove_operation
      ) != napi_ok ||
      napi_set_named_property(env, exports, "removeDirectory", remove_operation) != napi_ok) {
    return NULL;
  }
  return exports;
}
