/** Erros de domínio com código estável. A interface traduz o código em texto; nunca expõe detalhes técnicos. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Esta ação não está disponível para o seu perfil.") {
    super("forbidden", message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("conflict", message, details);
    this.name = "ConflictError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("validation", message, details);
    this.name = "ValidationError";
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
