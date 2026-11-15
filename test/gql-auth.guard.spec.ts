import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlAuthGuard } from '../src/identity/gql-auth.guard';
import { IdentityService } from '../src/identity/identity.service';

/** Minimal GraphQL ExecutionContext: GqlExecutionContext reads [root, args, context, info]. */
const graphqlContext = (req: Record<string, unknown>): ExecutionContext => {
  const args = [{}, {}, { req }, {}];
  return {
    getType: () => 'graphql',
    getArgs: () => args,
    getArgByIndex: (index: number) => args[index],
    getClass: () => Object,
    getHandler: () => () => undefined,
    switchToHttp: () => { throw new Error('not http'); },
    switchToRpc: () => { throw new Error('not rpc'); },
    switchToWs: () => { throw new Error('not ws'); },
  } as unknown as ExecutionContext;
};

describe('GqlAuthGuard', () => {
  it('authenticates the GraphQL request and attaches the user to it', async () => {
    const user = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };
    const identity = { authenticate: jest.fn().mockResolvedValue(user) };
    const guard = new GqlAuthGuard(identity as unknown as IdentityService);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer token-1' } };

    await expect(guard.canActivate(graphqlContext(req))).resolves.toBe(true);

    expect(identity.authenticate).toHaveBeenCalledWith(req);
    expect(req.user).toBe(user);
  });

  it('rejects the request when authentication fails, without attaching a user', async () => {
    const identity = { authenticate: jest.fn().mockRejectedValue(new UnauthorizedException('Sesión inválida o expirada.')) };
    const guard = new GqlAuthGuard(identity as unknown as IdentityService);
    const req: Record<string, unknown> = { headers: {} };

    await expect(guard.canActivate(graphqlContext(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });
});
