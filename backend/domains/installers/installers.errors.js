export class InstallerDomainError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "InstallerDomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function installerError(code, message, status = 400, details = {}) {
  return new InstallerDomainError(code, message, status, details);
}

export function serializeInstallerError(error) {
  if (error instanceof InstallerDomainError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "INSTALLER_INTERNAL_ERROR",
      code: "INSTALLER_INTERNAL_ERROR",
      message: process.env.NODE_ENV === "production" ? "Erreur installateur" : error?.message,
    },
  };
}
