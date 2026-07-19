export class DatabaseUnavailableError extends Error {
  constructor() {
    super("DATABASE_UNAVAILABLE");
    this.name = "DatabaseUnavailableError";
  }
}

export class DataIntegrityError extends Error {
  constructor() {
    super("DATA_INTEGRITY_ERROR");
    this.name = "DataIntegrityError";
  }
}

export class CountryNotFoundError extends Error {
  constructor() {
    super("COUNTRY_NOT_FOUND");
    this.name = "CountryNotFoundError";
  }
}
