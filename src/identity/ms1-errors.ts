import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/** gRPC status codes MS1 uses for identity, projects and work logs. */
export const GrpcCode = {
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  FAILED_PRECONDITION: 9,
  UNAVAILABLE: 14,
  UNAUTHENTICATED: 16,
} as const;

/** What the user was doing, to pick the message when MS1's text is not specific enough. */
export type Ms1Operation =
  | 'register'
  | 'login'
  | 'session'
  | 'workspace'
  | 'project'
  | 'addMember'
  | 'projectMember'
  | 'workLog';

export const MS1_UNAVAILABLE_MESSAGE =
  'El servicio de usuarios y proyectos no está disponible. Intenta de nuevo en unos segundos.';

const logger = new Logger('Ms1Errors');

/** Details of MS1's error (grpc-js puts "<code> <NAME>: <details>" in message). */
function detailsOf(err: any): string {
  return String(err?.details ?? err?.message ?? '');
}

function invalidArgumentMessage(details: string): string {
  if (details.includes('password must')) return 'La contraseña debe tener entre 10 y 200 caracteres.';
  if (details.includes('invalid user data')) return 'Ingresa un nombre y un email válidos.';
  if (details.includes('invalid project data')) {
    return 'El proyecto requiere nombre y una clave de 2 a 10 caracteres alfanuméricos.';
  }
  if (details.includes('hours must')) return 'Registra entre 0,01 y 24 horas por entrada.';
  if (details.includes('note must')) return 'La nota puede tener hasta 500 caracteres.';
  if (details.includes('member_email')) return 'Ingresa el email de la persona que quieres agregar.';
  if (details.includes('must be a valid UUID') || details.includes('is required')) {
    return 'El identificador enviado no es válido.';
  }
  return 'Los datos enviados no son válidos.';
}

/**
 * createIssue with parentId: MS1 rejects an unknown epic (NOT_FOUND) or a parent that is not an EPIC
 * of the same project, or an epic under an epic (INVALID_ARGUMENT). Other errors pass through unchanged.
 */
export function translateParentEpicError(err: any): unknown {
  const details = detailsOf(err);
  if (err?.code === GrpcCode.NOT_FOUND && details.includes('parent epic not found')) {
    return new NotFoundException('La épica seleccionada no existe.');
  }
  if (err?.code === GrpcCode.INVALID_ARGUMENT && details.includes('an epic cannot have a parent')) {
    return new BadRequestException('Una épica no puede pertenecer a otra épica.');
  }
  if (err?.code === GrpcCode.INVALID_ARGUMENT && details.includes('invalid parent epic')) {
    return new BadRequestException('La épica padre debe ser de tipo EPIC y pertenecer al mismo proyecto.');
  }
  return err;
}

/**
 * Converts an error from MS1 into a GraphQL-friendly Nest exception with a message in Spanish.
 * Exceptions that are already HTTP exceptions (thrown by the BFF itself) pass through unchanged.
 */
export function translateMs1Error(err: any, operation: Ms1Operation): HttpException {
  if (err instanceof HttpException) return err;
  const details = detailsOf(err);
  if (details.includes('not initialized')) return new ServiceUnavailableException(MS1_UNAVAILABLE_MESSAGE);

  switch (err?.code) {
    case GrpcCode.INVALID_ARGUMENT:
      return new BadRequestException(invalidArgumentMessage(details));
    case GrpcCode.ALREADY_EXISTS:
      return new ConflictException(
        details.includes('project key') ? 'Esa clave de proyecto ya está en uso.' : 'Ya existe una cuenta con ese email.',
      );
    case GrpcCode.UNAUTHENTICATED:
      return new UnauthorizedException('Email o contraseña incorrectos.');
    case GrpcCode.PERMISSION_DENIED:
      if (operation === 'projectMember' && !details.includes('project')) {
        return new ForbiddenException('Solo el OWNER o un ADMIN del espacio pueden gestionar los miembros del proyecto.');
      }
      return new ForbiddenException(
        operation === 'workLog' || details.includes('project')
          ? 'No tienes acceso a este proyecto.'
          : 'No tienes permisos suficientes en este espacio de trabajo.',
      );
    case GrpcCode.FAILED_PRECONDITION:
      return new ConflictException(
        'El OWNER y los ADMIN del espacio acceden a todos sus proyectos, así que no se pueden quitar de uno.',
      );
    case GrpcCode.NOT_FOUND:
      if (details.includes('issue not found')) {
        return new NotFoundException('La historia seleccionada no pertenece a este proyecto.');
      }
      if (details.includes('not a member of this project')) {
        return new NotFoundException('Esa persona no es miembro de este proyecto.');
      }
      if (operation === 'addMember' || operation === 'projectMember') {
        return new NotFoundException('El usuario debe crear una cuenta antes de que puedas agregarlo.');
      }
      if (operation === 'session') return new UnauthorizedException('La cuenta ya no está disponible.');
      return new NotFoundException('No se encontró el recurso solicitado.');
    case GrpcCode.UNAVAILABLE:
    case GrpcCode.DEADLINE_EXCEEDED:
      return new ServiceUnavailableException(MS1_UNAVAILABLE_MESSAGE);
    default:
      logger.error(`Unexpected MS1 error during ${operation}: ${details}`);
      return new InternalServerErrorException('No se pudo completar la operación. Intenta de nuevo.');
  }
}
