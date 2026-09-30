import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
  type CustomDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

export const PUBLIC_ROUTE = 'havefolio.public';
export const Public = (): CustomDecorator<string> => SetMetadata(PUBLIC_ROUTE, true);
export interface OwnerContext {
  id: string;
  email: string;
  displayName: string | null;
  sessionId: string;
}
export type OwnerRequest = Request & { owner?: OwnerContext };
export const CurrentOwner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OwnerContext => {
    const owner = context.switchToHttp().getRequest<OwnerRequest>().owner;
    if (!owner) throw new UnauthorizedException('AUTH_REQUIRED');
    return owner;
  },
);
