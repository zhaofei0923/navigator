import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";

interface HttpResponse {
  status(statusCode: number): HttpResponse;
  json(body: unknown): unknown;
}

interface SafeContractException {
  readonly body: unknown;
  readonly status: number;
}

const INTERNAL_ERROR_BODY = {
  error: {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  },
  success: false,
} as const;

const RESOURCE_NOT_FOUND_BODY = {
  error: {
    code: "NOT_FOUND",
    details: null,
    message: "Resource not found",
  },
  success: false,
} as const;

const VALIDATION_MESSAGES = new Set([
  "Invalid countries query",
  "Invalid country detail query",
  "Invalid country module query",
]);

const VALIDATION_DETAIL_KEYS = new Set([
  "coverageLevel",
  "industryTags",
  "locale",
  "moduleKey",
  "page",
  "pageSize",
  "region",
  "techTags",
  "textMode",
]);

@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (exception instanceof HttpException) {
      const safeException = safeContractException(exception);
      if (safeException !== null) {
        response.status(safeException.status).json(safeException.body);
        return;
      }
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(INTERNAL_ERROR_BODY);
  }
}

function safeContractException(
  exception: HttpException,
): SafeContractException | null {
  const status = exception.getStatus();
  const body = exception.getResponse();
  if (status === HttpStatus.BAD_REQUEST && isValidationErrorBody(body)) {
    return { body, status };
  }
  if (status === HttpStatus.NOT_FOUND) {
    return {
      body: isCountryNotFoundBody(body) ? body : RESOURCE_NOT_FOUND_BODY,
      status,
    };
  }
  if (status === HttpStatus.INTERNAL_SERVER_ERROR && isInternalErrorBody(body)) {
    return { body, status };
  }
  return null;
}

function isValidationErrorBody(value: unknown): boolean {
  if (!hasExactKeys(value, ["error", "success"]) || value.success !== false) {
    return false;
  }
  const error = value.error;
  if (
    !hasExactKeys(error, ["code", "details", "message"]) ||
    error.code !== "VALIDATION_ERROR" ||
    typeof error.message !== "string" ||
    !VALIDATION_MESSAGES.has(error.message)
  ) {
    return false;
  }
  const details = error.details;
  return (
    isRecord(details) &&
    Object.keys(details).length > 0 &&
    Object.entries(details).every(
      ([key, detail]) =>
        VALIDATION_DETAIL_KEYS.has(key) && typeof detail === "string",
    )
  );
}

function isCountryNotFoundBody(value: unknown): boolean {
  if (!hasExactKeys(value, ["error", "success"]) || value.success !== false) {
    return false;
  }
  const error = value.error;
  return (
    hasExactKeys(error, ["code", "details", "message"]) &&
    error.code === "NOT_FOUND" &&
    error.details === null &&
    error.message === "Country not found"
  );
}

function isInternalErrorBody(value: unknown): boolean {
  if (!hasExactKeys(value, ["error", "success"]) || value.success !== false) {
    return false;
  }
  const error = value.error;
  return (
    hasExactKeys(error, ["code", "message"]) &&
    error.code === "INTERNAL_ERROR" &&
    error.message === "Internal server error"
  );
}

function hasExactKeys<T extends string>(
  value: unknown,
  keys: readonly T[],
): value is Record<T, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
