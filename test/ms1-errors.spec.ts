import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MS1_UNAVAILABLE_MESSAGE, translateMs1Error, translateParentEpicError, translateStatusUpdateError } from '../src/identity/ms1-errors';

const grpcError = (code: number, details: string) => ({ code, details, message: `${code} X: ${details}` });

describe('translateMs1Error', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [3, 'validation error: invalid user data: password must have between 10 and 200 characters', 'register', BadRequestException, 'La contraseña debe tener entre 10 y 200 caracteres.'],
    [3, 'validation error: invalid user data: email is not valid', 'register', BadRequestException, 'Ingresa un nombre y un email válidos.'],
    [3, 'validation error: invalid project data: key must have 2 to 10 letters', 'project', BadRequestException, 'El proyecto requiere nombre y una clave de 2 a 10 caracteres alfanuméricos.'],
    [3, 'validation error: invalid work log: hours must be between 0.01 and 24 per entry', 'workLog', BadRequestException, 'Registra entre 0,01 y 24 horas por entrada.'],
    [3, 'validation error: invalid work log: note must have at most 500 characters', 'workLog', BadRequestException, 'La nota puede tener hasta 500 caracteres.'],
    [3, 'member_email is required', 'addMember', BadRequestException, 'Ingresa el email de la persona que quieres agregar.'],
    [3, 'project_id must be a valid UUID, got "x"', 'project', BadRequestException, 'El identificador enviado no es válido.'],
    [3, 'something else', 'project', BadRequestException, 'Los datos enviados no son válidos.'],
    [6, 'an account with that email already exists', 'register', ConflictException, 'Ya existe una cuenta con ese email.'],
    [6, 'project key already in use', 'project', ConflictException, 'Esa clave de proyecto ya está en uso.'],
    [16, 'invalid email or password', 'login', UnauthorizedException, 'Email o contraseña incorrectos.'],
    [7, 'not allowed in this workspace', 'addMember', ForbiddenException, 'No tienes permisos suficientes en este espacio de trabajo.'],
    [7, 'no access to this project', 'workLog', ForbiddenException, 'No tienes acceso a este proyecto.'],
    [5, 'user not found', 'addMember', NotFoundException, 'El usuario debe crear una cuenta antes de que puedas agregarlo.'],
    [5, 'user not found', 'session', UnauthorizedException, 'La cuenta ya no está disponible.'],
    [5, 'issue not found in this project', 'workLog', NotFoundException, 'La historia seleccionada no pertenece a este proyecto.'],
    [5, 'user not found', 'workspace', NotFoundException, 'No se encontró el recurso solicitado.'],
    [7, 'not allowed in this workspace', 'projectMember', ForbiddenException, 'Solo el OWNER o un ADMIN del espacio pueden gestionar los miembros del proyecto.'],
    [7, 'no access to this project', 'projectMember', ForbiddenException, 'No tienes acceso a este proyecto.'],
    [9, 'the OWNER and ADMINs reach every project through their workspace role and cannot be removed from one', 'projectMember', ConflictException, 'El OWNER y los ADMIN del espacio acceden a todos sus proyectos, así que no se pueden quitar de uno.'],
    [5, 'user is not a member of this project', 'projectMember', NotFoundException, 'Esa persona no es miembro de este proyecto.'],
    [5, 'user not found', 'projectMember', NotFoundException, 'El usuario debe crear una cuenta antes de que puedas agregarlo.'],
    [14, 'No connection established', 'login', ServiceUnavailableException, MS1_UNAVAILABLE_MESSAGE],
    [4, 'Deadline exceeded', 'project', ServiceUnavailableException, MS1_UNAVAILABLE_MESSAGE],
    [13, 'failed to register user: boom', 'register', InternalServerErrorException, 'No se pudo completar la operación. Intenta de nuevo.'],
  ] as const)('code %i "%s" during %s', (code, details, operation, type, message) => {
    const translated = translateMs1Error(grpcError(code, details), operation);
    expect(translated).toBeInstanceOf(type);
    expect(translated.message).toBe(message);
  });

  it('keeps exceptions thrown by the BFF itself and reports an uninitialized client as unavailable', () => {
    const own = new ForbiddenException('propia');
    expect(translateMs1Error(own, 'project')).toBe(own);
    expect(translateMs1Error(new Error('MS1 identity gRPC client not initialized'), 'login'))
      .toBeInstanceOf(ServiceUnavailableException);
    expect(translateMs1Error(undefined, 'login')).toBeInstanceOf(InternalServerErrorException);
  });
});

describe('translateParentEpicError', () => {
  it('translates the parent epic errors of createIssue', () => {
    expect(translateParentEpicError(grpcError(5, 'parent epic not found: parent epic not found')))
      .toEqual(new NotFoundException('La épica seleccionada no existe.'));
    expect(translateParentEpicError(grpcError(3, 'validation error: invalid parent epic: an epic cannot have a parent')))
      .toEqual(new BadRequestException('Una épica no puede pertenecer a otra épica.'));
    expect(translateParentEpicError(grpcError(3, 'validation error: invalid parent epic: x is a TASK, not an EPIC')))
      .toEqual(new BadRequestException('La épica padre debe ser de tipo EPIC y pertenecer al mismo proyecto.'));
  });

  it('leaves any other error untouched', () => {
    const other = grpcError(3, 'title cannot be empty');
    expect(translateParentEpicError(other)).toBe(other);
  });
});

describe('translateStatusUpdateError', () => {
  it('translates concurrency abort and invalid status transitions into Spanish messages', () => {
    expect(translateStatusUpdateError(grpcError(10, 'issue changed while updating status; retry')))
      .toEqual(new BadRequestException('La incidencia cambió mientras la movías, vuelve a intentarlo.'));
    expect(translateStatusUpdateError(grpcError(9, 'cannot transition from TODO to DONE')))
      .toEqual(new BadRequestException('No se puede mover la incidencia a ese estado.'));
    expect(translateStatusUpdateError(grpcError(3, 'invalid status 99')))
      .toEqual(new BadRequestException('No se puede mover la incidencia a ese estado.'));
    expect(translateStatusUpdateError(grpcError(5, 'issue not found: 123')))
      .toEqual(new NotFoundException('La incidencia seleccionada no existe.'));
  });

  it('leaves other errors untouched', () => {
    const other = grpcError(14, 'No connection established');
    expect(translateStatusUpdateError(other)).toBe(other);
  });
});
